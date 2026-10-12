/*
 * LD_PRELOAD shim (T-SBX / P2-005): blocks `socket()` for AF_INET / AF_INET6.
 *
 * This is the OS-level enforcement primitive for sandboxed transform workers.
 * Only loopback (AF_INET/AF_INET6) network access is refused at the kernel
 * boundary. AF_UNIX (local IPC) is left untouched.
 *
 * Build with: cc -shared -fPIC -o block-socket.so block-socket.c -ldl
 * Usage: LD_PRELOAD=/path/to/block-socket.so node worker.js
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/socket.h>
#include <errno.h>
#include <stdio.h>

int socket(int domain, int type, int protocol) {
    if (domain == AF_INET || domain == AF_INET6) {
        fprintf(stderr, "[block-socket] blocked AF_INET/AF_INET6 socket()\n");
        errno = EACCES;
        return -1;
    }
    static int (*real_socket)(int, int, int) = 0;
    if (!real_socket) real_socket = dlsym(RTLD_NEXT, "socket");
    return real_socket(domain, type, protocol);
}
