"""Listings of the scope's SMB share that stay cheap as a folder grows.

A long night leaves a big sub folder: three files per sub (`.fit`, `.jpg`,
`_thn.jpg`), so 1003 subs are 3,009 entries. Measured on 2026-09-24 against
the real share, listing that folder three ways (parked scope, same machine,
one run each):

    Path.glob("Light_*_thn.jpg")                          5.90 s
    os.scandir, every entry                               4.65 s
    FindFirstFileExW("Light_*_thn.jpg", LARGE_FETCH)      0.26 s

`Path.glob` is `os.scandir` plus a name filter in Python, and on Windows
`os.scandir` always asks the share for `*`, so every entry crosses the Wi-Fi
to be thrown away here. FindFirstFileExW sends the pattern with the directory
query, so the server filters, and FIND_FIRST_EX_LARGE_FETCH asks for bigger
batches per round trip. Either scan the sidecar used before this module
existed ran past live_preview.SHARE_SCAN_TIMEOUT_SECONDS on that folder,
which the preview then reported as an unreachable share.

Each entry's type and, on Windows, its last-write time come from the listing
itself. There is no stat per entry: over SMB a stat is a round trip, and a
per-entry stat is what live_preview._newest_by_filename() was written to
avoid.

The pattern is only a pre-filter. The server applies its own wildcard rules
(case-insensitive, and possibly matching 8.3 short names), so a caller must
still check every name against its exact rule.

Elsewhere than Windows, `_list_portable` does the same job with `os.scandir`,
filtering here and leaving the mtime to `entry_mtime()`, so that only the one
entry a caller picks is ever stat-ed.
"""
import fnmatch
import os
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ShareEntry:
    path: Path
    is_dir: bool
    #: POSIX seconds from the listing itself, or `None` when the listing did
    #: not carry one (the portable path). Read it through entry_mtime().
    mtime: float | None

    @property
    def name(self) -> str:
        return self.path.name


def entry_mtime(entry: ShareEntry) -> float:
    """`entry`'s mtime: the listing's own when it had one, else one stat."""
    return entry.mtime if entry.mtime is not None else entry.path.stat().st_mtime


def list_matching(directory: Path, pattern: str = "*") -> list[ShareEntry]:
    """Entries of `directory` whose names match the shell wildcard `pattern`,
    without `.` and `..`. An existing folder with no match gives `[]`. A
    folder that cannot be listed (missing, or the share unreachable) raises
    OSError, so "nothing there" and "could not look" stay distinct.
    """
    if sys.platform == "win32":
        return _list_windows(directory, pattern)
    return _list_portable(directory, pattern)


def _list_portable(directory: Path, pattern: str) -> list[ShareEntry]:
    entries = []
    with os.scandir(directory) as it:
        for entry in it:
            if not fnmatch.fnmatch(entry.name, pattern):
                continue
            try:
                is_dir = entry.is_dir()
            except OSError:
                continue
            entries.append(ShareEntry(path=directory / entry.name, is_dir=is_dir, mtime=None))
    return entries


if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    class _FindData(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD),
            ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME),
            ("ftLastWriteTime", wintypes.FILETIME),
            ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD),
            ("dwReserved0", wintypes.DWORD),
            ("dwReserved1", wintypes.DWORD),
            ("cFileName", wintypes.WCHAR * 260),
            ("cAlternateFileName", wintypes.WCHAR * 14),
        ]

    # A private kernel32 handle, so these argtypes never leak into anyone
    # else's ctypes.windll.kernel32.
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _find_first = _kernel32.FindFirstFileExW
    _find_first.argtypes = [
        wintypes.LPCWSTR, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
    ]
    _find_first.restype = wintypes.HANDLE
    _find_next = _kernel32.FindNextFileW
    _find_next.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    _find_next.restype = wintypes.BOOL
    _find_close = _kernel32.FindClose
    _find_close.argtypes = [wintypes.HANDLE]
    _find_close.restype = wintypes.BOOL

    _FIND_EX_INFO_BASIC = 1  # skip the 8.3 short name
    _FIND_EX_SEARCH_NAME_MATCH = 0
    _FIND_FIRST_EX_LARGE_FETCH = 2
    _ERROR_FILE_NOT_FOUND = 2  # the folder exists, nothing in it matches
    _ERROR_NO_MORE_FILES = 18
    _FILE_ATTRIBUTE_DIRECTORY = 0x10
    _INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
    #: 1970-01-01 as a FILETIME (100 ns ticks since 1601-01-01).
    _UNIX_EPOCH_AS_FILETIME = 116_444_736_000_000_000

    def _os_error(code: int, directory: Path) -> OSError:
        # The 4-argument form maps the Windows code to the right subclass
        # (FileNotFoundError for a missing folder or network path).
        return OSError(0, ctypes.FormatError(code), str(directory), code)

    def _list_windows(directory: Path, pattern: str) -> list[ShareEntry]:
        data = _FindData()
        handle = _find_first(
            str(directory / pattern),
            _FIND_EX_INFO_BASIC,
            ctypes.byref(data),
            _FIND_EX_SEARCH_NAME_MATCH,
            None,
            _FIND_FIRST_EX_LARGE_FETCH,
        )
        if handle == _INVALID_HANDLE_VALUE:
            code = ctypes.get_last_error()
            if code == _ERROR_FILE_NOT_FOUND:
                return []
            raise _os_error(code, directory)
        entries = []
        try:
            while True:
                name = data.cFileName
                if name not in (".", ".."):
                    written = data.ftLastWriteTime
                    ticks = (written.dwHighDateTime << 32) | written.dwLowDateTime
                    entries.append(
                        ShareEntry(
                            path=directory / name,
                            is_dir=bool(data.dwFileAttributes & _FILE_ATTRIBUTE_DIRECTORY),
                            mtime=(ticks - _UNIX_EPOCH_AS_FILETIME) / 10_000_000,
                        )
                    )
                if not _find_next(handle, ctypes.byref(data)):
                    code = ctypes.get_last_error()
                    if code == _ERROR_NO_MORE_FILES:
                        return entries
                    raise _os_error(code, directory)
        finally:
            _find_close(handle)
