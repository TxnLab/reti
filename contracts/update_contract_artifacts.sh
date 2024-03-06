#!/bin/bash
rm -rf ../nodemgr/internal/lib/reti/artifacts/contracts/
set -e
mkdir -p ../nodemgr/internal/lib/reti/artifacts/contracts/
cp ./contracts/artifacts/*arc32* ../nodemgr/internal/lib/reti/artifacts/contracts/

# Update UI contract clients
rm -rf ../ui/src/contracts/
mkdir -p ../ui/src/contracts/
cp ./contracts/clients/*.ts ../ui/src/contracts/
