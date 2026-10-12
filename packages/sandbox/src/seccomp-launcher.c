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
 * What it does NOT enforce: file access. Reading or writing files (including /proc/<pid>/mem of other
 * processes of the same user) is governed by the filesystem / namespace layer (bubblewrap) when available.
 *
 * Usage: ir-seccomp-exec <program> [args...]
 */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
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

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: ir-seccomp-exec <program> [args...]\n");
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
  execvp(argv[1], argv + 1);
  perror("ir-seccomp-exec: exec");
  return 72;
}
