/*
 * ir-seccomp-exec (T-SBX / P2-005): installs a seccomp-bpf filter and execs the given program.
 *
 * What it enforces (in the KERNEL, for this process and every descendant; a filter can never be removed, only
 * made stricter, and PR_SET_NO_NEW_PRIVS prevents gaining privileges through setuid binaries):
 *   - any syscall from a foreign architecture ABI (e.g. 32-bit int 0x80 on x86_64)  -> process killed
 *   - x32 syscall numbers on x86_64                                                -> process killed
 *   - socket, connect, bind, listen, accept, accept4                               -> EACCES
 *     (no new socket of any family: no TCP/UDP, no AF_UNIX, no AF_NETLINK, no raw sockets;
 *      socketpair stays allowed because it can only connect the process to itself)
 *   - io_uring_setup / io_uring_enter / io_uring_register                          -> ENOSYS
 *     (io_uring can perform network operations without the syscalls above)
 *   - ptrace, process_vm_readv, process_vm_writev, pidfd_getfd                     -> EPERM
 *   - unshare, setns, mount, bpf, perf_event_open, userfaultfd, keyctl, add_key    -> EPERM
 *
 * Resource limits (P2-034): leading `--rlimit=<name>:<value>` options are applied with setrlimit(2), soft = hard,
 * BEFORE the filter and the exec. With PR_SET_NO_NEW_PRIVS and no CAP_SYS_RESOURCE the program (and every
 * descendant, which inherits them) can only lower them. Names: as (address space), data, fsize, nofile, nproc,
 * cpu (seconds), core. An unknown name, a malformed value or a failed setrlimit is fatal (exit 73): the launcher
 * never runs the program with weaker limits than it was asked for.
 *
 * What it does NOT enforce: file access. Reading or writing files (including /proc/<pid>/mem of other
 * processes of the same user) is governed by the filesystem / namespace layer (bubblewrap) when available.
 *
 * Usage: ir-seccomp-exec [--rlimit=<name>:<value>]... <program> [args...]
 */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define IR_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define IR_ARCH AUDIT_ARCH_AARCH64
#else
#error "ir-seccomp-exec: unsupported architecture"
#endif

#define IR_DENY(nr, err) \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (nr), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ((err) & SECCOMP_RET_DATA))

static int rlimit_resource(const char *name) {
  if (strcmp(name, "as") == 0) return RLIMIT_AS;
  if (strcmp(name, "data") == 0) return RLIMIT_DATA;
  if (strcmp(name, "fsize") == 0) return RLIMIT_FSIZE;
  if (strcmp(name, "nofile") == 0) return RLIMIT_NOFILE;
  if (strcmp(name, "nproc") == 0) return RLIMIT_NPROC;
  if (strcmp(name, "cpu") == 0) return RLIMIT_CPU;
  if (strcmp(name, "core") == 0) return RLIMIT_CORE;
  return -1;
}

/* Parses "--rlimit=<name>:<value>" and applies it (soft = hard). Returns 0 on success. */
static int apply_rlimit(const char *opt) {
  const char *spec = opt + strlen("--rlimit=");
  const char *colon = strchr(spec, ':');
  if (!colon || colon == spec || colon - spec >= 16) return -1;
  char name[16];
  memcpy(name, spec, (size_t)(colon - spec));
  name[colon - spec] = '\0';
  int resource = rlimit_resource(name);
  if (resource < 0) return -1;
  const char *digits = colon + 1;
  if (*digits < '0' || *digits > '9') return -1;
  char *end = NULL;
  errno = 0;
  unsigned long long value = strtoull(digits, &end, 10);
  if (errno != 0 || !end || *end != '\0') return -1;
  struct rlimit rl = { .rlim_cur = (rlim_t)value, .rlim_max = (rlim_t)value };
  return setrlimit(resource, &rl);
}

int main(int argc, char **argv) {
  int first = 1;
  while (first < argc && strncmp(argv[first], "--rlimit=", 9) == 0) {
    if (apply_rlimit(argv[first]) != 0) {
      fprintf(stderr, "ir-seccomp-exec: cannot apply %s\n", argv[first]);
      return 73;
    }
    first++;
  }
  if (first >= argc) {
    fprintf(stderr, "usage: ir-seccomp-exec [--rlimit=<name>:<value>]... <program> [args...]\n");
    return 64;
  }
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, IR_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
    IR_DENY(__NR_socket, EACCES),
    IR_DENY(__NR_connect, EACCES),
    IR_DENY(__NR_bind, EACCES),
    IR_DENY(__NR_listen, EACCES),
    IR_DENY(__NR_accept, EACCES),
    IR_DENY(__NR_accept4, EACCES),
    IR_DENY(__NR_io_uring_setup, ENOSYS),
    IR_DENY(__NR_io_uring_enter, ENOSYS),
    IR_DENY(__NR_io_uring_register, ENOSYS),
    IR_DENY(__NR_ptrace, EPERM),
    IR_DENY(__NR_process_vm_readv, EPERM),
    IR_DENY(__NR_process_vm_writev, EPERM),
    IR_DENY(__NR_pidfd_getfd, EPERM),
    IR_DENY(__NR_unshare, EPERM),
    IR_DENY(__NR_setns, EPERM),
    IR_DENY(__NR_mount, EPERM),
    IR_DENY(__NR_bpf, EPERM),
    IR_DENY(__NR_perf_event_open, EPERM),
    IR_DENY(__NR_userfaultfd, EPERM),
    IR_DENY(__NR_keyctl, EPERM),
    IR_DENY(__NR_add_key, EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("ir-seccomp-exec: PR_SET_NO_NEW_PRIVS");
    return 70;
  }
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) {
    perror("ir-seccomp-exec: seccomp");
    return 71;
  }
  execvp(argv[first], argv + first);
  perror("ir-seccomp-exec: exec");
  return 72;
}
