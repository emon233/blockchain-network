require('dotenv').config();


const Web3Module = require("web3");
const Web3 = Web3Module.Web3;

const express = require('express');
const { ethers, formatEther, Wallet } = require('ethers');

const port = process.env.EVM_NETWORK_PORT || 5001;

const erc20Abi = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
];

const app = express();
const api = express.Router();
app.use(express.json());
app.use('/api', api);


/**
 * Status Check API
 */
api.get('/check', async (req, res) => {
    try {        
        return res.json(`!! Hello World !!`);
    } catch(error) {
        return res.json(false);
    }
});


/**
 * Test Route
 */
api.post('/test', async (req, res) => {
    try {
        let { rpc } = req.body;
        
        const provider = new ethers.JsonRpcProvider(rpc);
        const latestBlock = await provider.getBlock('latest');
        
        return res.json({
            'latestBlock': latestBlock.number,
            'hash': latestBlock.hash
        });

    } catch(error) {
        return res.json(false);
    }
});


/**
 * Check if a given address is valid
 */
api.post('/check-address', async (req, res) => {
    try {
        let { address } = req.body;
        
        if(ethers.isAddress(address)) {
            return res.json(true);
        } else {
            return res.json(false);
        }
    } catch(error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});



/**
 * Get latest block
 */
api.post('/get-latest-block', async (req, res) => {
    try {
        const { rpc } = req.body;
        
        const provider = new ethers.JsonRpcProvider(rpc);
        const latestBlock = await provider.getBlock('latest');

        if (!latestBlock) {
            return res.json(false);
        }

        return res.json({
            number: latestBlock.number,
            hash: latestBlock.hash,
            timestamp: latestBlock.timestamp,
            transactionsCount: latestBlock.transactions.length,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Generate new Wallet 
 */
api.get('/generate-wallet', (req, res) => {
    try {
        const wallet = ethers.Wallet.createRandom();
        
        return res.json({
            address: wallet.address,
            privateKey: wallet.privateKey,
            mnemonic: wallet.mnemonic.phrase,
            publicKey: wallet.signingKey.publicKey
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get Wallet info from private-key
 */
api.post('/get-wallet-from-private-key', async (req, res) => {
    try {
        let { privateKey } = req.body;

        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }
        
        const wallet = new Wallet(privateKey);
        
        return res.json({ 
            address: wallet.address,
            privateKey: privateKey,
            publicKey: wallet.signingKey.publicKey
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get Wallet info from public-key
 */
api.post('/get-address-from-public-key', async (req, res) => {
    try {
        let { publicKey } = req.body;

        if (!publicKey.startsWith('0x')) {
            publicKey = '0x' + publicKey;
        }
        
        const address = ethers.computeAddress(publicKey);
        
        return res.json({ 
            address: address
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get the native balance of an address
 */
api.post('/get-native-balance', async (req, res) => {
    const { rpc, address } = req.body;

    if (!address || !ethers.isAddress(address)) {
        return res.json(false);
    }

    if (!address.startsWith('0x')) {
        address = '0x' + address;
    }

    try {
        const provider = new ethers.JsonRpcProvider(rpc);
        const balance = await provider.getBalance(address);
        const ethBalance = ethers.formatEther(balance);
        return res.json({ 
            balance: ethBalance 
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get the token balance of an address
 */
api.post('/get-token-balance', async (req, res) => {
    try {
        const { rpc, address, tokenAddress } = req.body;

        if (!address || !tokenAddress || !ethers.isAddress(address) || !ethers.isAddress(tokenAddress)) {
            return res.json(false);
        }

        if (!address.startsWith('0x')) {
            address = '0x' + address;
        }

        if (!tokenAddress.startsWith('0x')) {
            tokenAddress = '0x' + tokenAddress;
        }

        const provider = new ethers.JsonRpcProvider(rpc);
        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

        const balance = await tokenContract.balanceOf(address);

        let decimals = 18;
        try {
            decimals = await tokenContract.decimals();
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 18. ${error.toString()}`);
        }

        const ethBalance = ethers.formatUnits(balance, decimals);

        return res.json({
            balance: ethBalance,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});



/**
 * Send native balance to given address
 */
api.post('/send-native-balance', async (req, res) => {
    try {
        let { rpc, privateKey, toAddress, amount } = req.body;

        if (
            !privateKey || !toAddress || !amount ||
            !ethers.isAddress(toAddress) ||
            typeof amount !== 'string' || isNaN(amount)
        ) {
            return res.json(false);
        }

        if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
        }

        if (!toAddress.startsWith('0x')) {
            toAddress = '0x' + toAddress;
        }

        const provider = new ethers.JsonRpcProvider(rpc);
        const wallet = new ethers.Wallet(privateKey, provider);

        const tx = {
            to: toAddress,
            value: ethers.parseEther(amount),
        };

        const txResponse = await wallet.sendTransaction(tx);
        await txResponse.wait();

        return res.json({
            hash: txResponse.hash,
            from: txResponse.from,
            to: txResponse.to,
            amount: amount,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Send given token balance to given address
 */
api.post('/send-token-balance', async (req, res) => {
    try {
        let { rpc, privateKey, tokenAddress, toAddress, amount } = req.body;

        if (
            !privateKey || !tokenAddress || !toAddress || !amount ||
            !ethers.isAddress(tokenAddress) ||
            !ethers.isAddress(toAddress) ||
            typeof amount !== 'string' || isNaN(amount)
        ) {
            return res.json(false);
        }

        const provider = new ethers.JsonRpcProvider(rpc);
        const wallet = new ethers.Wallet(privateKey, provider);

        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);

        let decimals = 18;
        try {
            decimals = await tokenContract.decimals();
        } catch (error) {
            console.log(`Warning: could not get decimals, defaulting to 18. ${error.toString()}`);
        }

        const rawAmount = ethers.parseUnits(amount, decimals);
        const txResponse = await tokenContract.transfer(toAddress, rawAmount);
        await txResponse.wait();

        return res.json({
            hash: txResponse.hash,
            from: txResponse.from,
            to: toAddress,
            token: txResponse.to,
            amount: amount,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get the native transaction details
 */
api.post('/get-native-transaction', async (req, res) => {
    try {
        let { rpc, txHash } = req.body;

        if (!txHash) {
            return res.json(false);
        }

        const provider = new ethers.JsonRpcProvider(rpc);
        const tx = await provider.getTransaction(txHash);
        
        if (!tx) {
            return res.json(false);
        }

        const receipt = await provider.getTransactionReceipt(txHash);

        if(!receipt) {
            return res.json(false);
        }

        return res.json({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: ethers.formatEther(tx.value),
            blockNumber: tx.blockNumber
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get the token transaction details
 */
api.post('/get-token-transaction', async (req, res) => {
    try {
        let { rpc, txHash, tokenAddress } = req.body;

        if (!txHash || !tokenAddress || !rpc) {
            return res.json(false);
        }

        const provider = new ethers.JsonRpcProvider(rpc);
        const receipt = await provider.getTransactionReceipt(txHash);

        if(!receipt) {
            return res.json(false);
        }

        const abi = [
            "function decimals() view returns (uint8)",
            "event Transfer(address indexed from, address indexed to, uint256 value)"
        ];
        const tokenContract = new ethers.Contract(tokenAddress, abi, provider);
        const decimals = await tokenContract.decimals();

        const iface = new ethers.Interface(abi);
        const transfers = [];
        
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() === tokenAddress.toLowerCase()) {

                try {
                    const parsed = iface.parseLog(log);
                    console.log(parsed);
                    transfers.push({
                        hash: txHash,
                        from: parsed.args.from,
                        to: parsed.args.to,
                        value: ethers.formatUnits(parsed.args.value, decimals),
                        blockNumber: receipt.blockNumber,
                    });
                } catch (e) {
                    // Not a Transfer event
                }   
            }
        }

        return res.json({
            tokenTransfers: transfers
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get native transfer histories by block number
 */
api.post("/get-native-transfer-histories-by-block-number", async (req, res) => {
    try {
        const { prpc, fromBlockNumber, toBlockNumber } = req.body;
        
        const transactions = [];
        var lastBlock = toBlockNumber;
        
        const web3 = new Web3(prpc);
        if (!fromBlockNumber) return res.json(false);

        for (let blockNumber = fromBlockNumber; blockNumber <= toBlockNumber; blockNumber++) {
            try {
                const block = await web3.eth.getBlock(blockNumber, true);
                if (block && block.transactions) {
                    const nativeTxs = block.transactions.filter(tx => tx.input === '0x' && BigInt(tx.value) > 0n);
                    const decoded = nativeTxs.map(tx => {
                        return {
                            from: tx.from,
                            to: tx.to,
                            value: ethers.formatEther(tx.value, 'ether'),
                            blockNumber: Number(tx.blockNumber),
                            hash: tx.hash,
                            timestamp: Number(block.timestamp)
                        };
                    });

                    transactions.push(...decoded);
                } else{
                    lastBlock = blockNumber
                    return res.json({
                        transactions: transactions,
                        last_block: lastBlock
                    });
                }
            } catch (err) {
                console.error(`Error fetching block ${blockNumber}:`, err);
            }
        }
             
        return res.json({
            transactions: transactions,
            last_block: lastBlock
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});


/**
 * Get token transaction histories by blocknumber
 */
api.post("/get-token-transfer-histories-by-block-number", async (req, res) => {
    try {
        const { prpc, tokenAddress, fromBlockNumber, toBlockNumber } = req.body;

        // Basic validation
        if (!tokenAddress || fromBlockNumber == null || toBlockNumber == null) {
            return res.json(false);
        }

        const provider = new ethers.JsonRpcProvider(prpc);

        const abi = [
            "function decimals() view returns (uint8)",
            "event Transfer(address indexed from, address indexed to, uint256 value)"
        ];
        const tokenContract = new ethers.Contract(tokenAddress, abi, provider);
        const decimals = await tokenContract.decimals();

        const iface = new ethers.Interface(abi);

        // Manually compute the topic hash for the Transfer event
        const transferTopic = ethers.id("Transfer(address,address,uint256)");

        // Fetch logs from the block
        const logs = await provider.getLogs({
            address: tokenAddress,
            fromBlock: BigInt(fromBlockNumber),
            toBlock: BigInt(toBlockNumber),
            topics: [transferTopic]
        });

        const decoded = logs.map(log => {
            try {
                const parsed = iface.parseLog(log);

                return {
                    from: parsed.args.from,
                    to: parsed.args.to,
                    value: ethers.formatUnits(parsed.args.value, decimals),
                    blockNumber: Number(log.blockNumber),
                    hash: log.transactionHash
                };
            } catch (err) {
                console.warn(`Log parsing failed: ${log.transactionHash}`);
                return null;
            }
        }).filter(Boolean);

        const latestBlock = await provider.getBlock('latest');

        let last_block = latestBlock.number > toBlockNumber ? toBlockNumber : latestBlock.number;
        return res.json({
            transactions: decoded,
            last_block: last_block,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});



app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});



/** Function structure */

api.post('/function-structure', async (req, res) => {
    try {
        const { rpc_url, prpc_url, chain_id } = req.body;
        
        const provider = new ethers.JsonRpcProvider(rpc);
    } catch(error) {
        console.log(`${error.toString()}`);
        return response.json(false);
    }
});

/** End Function structure */