#!/bin/sh

rm -f ../testchain/geth/chaindata/*

geth --datadir ../testchain init genesis.json

geth --datadir ../testchain --unlock 0x8ae386892b59bd2a7546a9468e8e847d61955991 --password ./testpassword --rpc --rpccorsdomain '*' --rpcport 8646 --rpcapi "eth,net,web3,debug" --ws --wsport 8647 --wsaddr "localhost" --wsorigins="*" --port 32323 --mine --minerthreads 1 --maxpeers 0 --targetgaslimit 994712388 console
