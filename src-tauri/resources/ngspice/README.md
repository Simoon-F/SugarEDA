# Bundled ngspice payload

Release builds place a verified executable at `PLATFORM/ngspice` (`ngspice.exe` on Windows). Run `npm run prepare:ngspice -- /trusted/path/to/ngspice` on each release runner before packaging. When a distribution requires adjacent DLLs or runtime assets, pass a directory containing the executable and dependencies; the script copies the complete payload. Generated binaries are intentionally excluded from source control and must be accompanied by the applicable upstream notices and corresponding-source offer after license review.
