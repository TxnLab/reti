#!/bin/bash
rm -rf ../nodemgr/internal/lib/reti/artifacts/contracts/
set -e
mkdir -p ../nodemgr/internal/lib/reti/artifacts/contracts/
cp ./contracts/artifacts/*arc32* ../nodemgr/internal/lib/reti/artifacts/contracts/
