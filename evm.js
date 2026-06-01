require('dotenv').config();

const Web3Module = require('web3');
const Web3 = Web3Module.Web3;

const express = require('express');
const { ethers, Wallet } = require('ethers');

const rpcUrl = process.env.EVM_RPC_URL;
const paidRpcUrl = process.env.EVM_PAID_RPC_URL;
const port = process.env.EVM_PORT || 5000;
const chainId = process.env.EVM_CHAIN_ID ? Number(process.env.EVM_CHAIN_ID) : null;
const maxBlockRange = Number(process.env.EVM_MAX_BLOCK_RANGE || 2000);

if (!rpcUrl) {
    console.error('EVM_RPC_URL environment variable is required');
    process.exit(1);
}

if (!paidRpcUrl) {
    console.warn('EVM_PAID_RPC_URL is not set; block history endpoints will fail');
}

const app = express();
const api = express.Router();
app.use(express.json());
app.use('/api', api);

const provider = new ethers.JsonRpcProvider(rpcUrl);
const paidProvider = paidRpcUrl ? new ethers.JsonRpcProvider(paidRpcUrl) : null;

const erc20Abi = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
];

const transferEventAbi = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
];

function normalizeHexAddress(address) {
    if (address === undefined || address === null) {
        return null;
    }

    const trimmed = String(address).trim();
    const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;

    return ethers.isAddress(withPrefix) ? ethers.getAddress(withPrefix) : null;
}

function normalizePrivateKey(privateKey) {
    if (privateKey === undefined || privateKey === null) {
        return null;
    }

    const trimmed = String(privateKey).trim();
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function parseAmount(amount) {
    if (amount === undefined || amount === null) {
        return null;
    }

    const amountStr = typeof amount === 'number' ? String(amount) : String(amount).trim();

    if (amountStr === '' || Number.isNaN(Number(amountStr))) {
        return null;
    }

    return amountStr;
}

function normalizePublicKey(publicKey) {
    if (publicKey === undefined || publicKey === null) {
        return null;
    }

    const trimmed = String(publicKey).trim();
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function normalizeTxHash(txHash) {
    if (txHash === undefined || txHash === null) {
        return null;
    }

    const trimmed = String(txHash).trim();
    const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
    return /^0x[0-9a-fA-F]{64}$/.test(withPrefix) ? withPrefix : null;
}

async function fetchLatestBlockData(blockProvider = provider) {
    const latestBlock = await blockProvider.getBlock('latest');

    if (!latestBlock) {
        return null;
    }

    return {
        number: latestBlock.number,
        hash: latestBlock.hash,
        timestamp: latestBlock.timestamp,
        transactionsCount: latestBlock.transactions.length,
    };
}

function parseBlockRange(fromBlockNumber, toBlockNumber, blockNumber) {
    const fromBlock = fromBlockNumber ?? blockNumber;
    const toBlock = toBlockNumber ?? blockNumber;

    if (fromBlock === undefined || fromBlock === null || toBlock === undefined || toBlock === null) {
        return null;
    }

    const from = Number(fromBlock);
    const to = Number(toBlock);

    if (
        Number.isNaN(from) ||
        Number.isNaN(to) ||
        from < 0 ||
        to < 0 ||
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from > to ||
        (to - from + 1) > maxBlockRange
    ) {
        return null;
    }

    return { from, to };
}

function handleLatestBlock(req, res) {
    fetchLatestBlockData()
        .then((blockData) => {
            if (!blockData) {
                return res.json(false);
            }

            return res.json(blockData);
        })
        .catch((error) => {
            console.log(`${error.toString()}`);
            return res.json(false);
        });
}

/**
 * Status check
 */
api.get('/check', (req, res) => {
    return res.json({
        message: '!! Hello World !!',
        rpcConfigured: Boolean(rpcUrl),
        paidRpcConfigured: Boolean(paidRpcUrl),
        chainId,
    });
});


/**
 * Test RPC connectivity (uses EVM_RPC_URL from env)
 */
api.post('/test-rpc', async (req, res) => {
    try {
        const latestBlock = await provider.getBlock('latest');

        if (!latestBlock) {
            return res.json(false);
        }

        return res.json({
            latestBlock: latestBlock.number,
            hash: latestBlock.hash,
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
            publicKey: wallet.signingKey.publicKey,
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
        const privateKey = normalizePrivateKey(req.body.privateKey);

        if (!privateKey) {
            return res.json(false);
        }

        const wallet = new Wallet(privateKey);

        return res.json({
            address: wallet.address,
            privateKey,
            publicKey: wallet.signingKey.publicKey,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Get address from public key
 */
api.post('/get-address-from-public-key', async (req, res) => {
    try {
        const publicKey = normalizePublicKey(req.body.publicKey);

        if (!publicKey) {
            return res.json(false);
        }

        const address = ethers.computeAddress(publicKey);

        return res.json({
            address,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Check if a given address is valid
 */
api.post('/check-address', async (req, res) => {
    try {
        const address = normalizeHexAddress(req.body.address);
        return res.json(Boolean(address));
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Get the native balance of an address
 */
api.post('/get-native-balance', async (req, res) => {
    try {
        const address = normalizeHexAddress(req.body.address);

        if (!address) {
            return res.json(false);
        }

        const balance = await provider.getBalance(address);

        return res.json({
            balance: ethers.formatEther(balance),
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
        const address = normalizeHexAddress(req.body.address);
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);

        if (!address || !tokenAddress) {
            return res.json(false);
        }

        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
        const balance = await tokenContract.balanceOf(address);

        let decimals = 18;
        try {
            decimals = await tokenContract.decimals();
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 18. ${error.toString()}`);
        }

        return res.json({
            balance: ethers.formatUnits(balance, decimals),
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
        const privateKey = normalizePrivateKey(req.body.privateKey);
        const toAddress = normalizeHexAddress(req.body.toAddress);
        const amount = parseAmount(req.body.amount);

        if (!privateKey || !toAddress || !amount) {
            return res.json(false);
        }

        const wallet = new ethers.Wallet(privateKey, provider);

        const txResponse = await wallet.sendTransaction({
            to: toAddress,
            value: ethers.parseEther(amount),
        });
        await txResponse.wait();

        return res.json({
            hash: txResponse.hash,
            from: txResponse.from ?? wallet.address,
            to: txResponse.to ?? toAddress,
            amount,
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
        const privateKey = normalizePrivateKey(req.body.privateKey);
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);
        const toAddress = normalizeHexAddress(req.body.toAddress);
        const amount = parseAmount(req.body.amount);

        if (!privateKey || !tokenAddress || !toAddress || !amount) {
            return res.json(false);
        }

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
            from: txResponse.from ?? wallet.address,
            to: toAddress,
            token: tokenAddress,
            amount,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Get Latest Block
 */
api.get('/get-latest-block', handleLatestBlock);
api.post('/get-latest-block', handleLatestBlock);

/**
 * Get native transaction details by hash
 */
api.post('/get-native-transaction', async (req, res) => {
    try {
        const txHash = normalizeTxHash(req.body.txHash);

        if (!txHash) {
            return res.json(false);
        }

        const tx = await provider.getTransaction(txHash);

        if (!tx) {
            return res.json(false);
        }

        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            return res.json(false);
        }

        return res.json({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: ethers.formatEther(tx.value),
            blockNumber: tx.blockNumber,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Get token transfer details from a transaction receipt
 */
api.post('/get-token-transaction', async (req, res) => {
    try {
        const txHash = normalizeTxHash(req.body.txHash);
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);

        if (!txHash || !tokenAddress) {
            return res.json(false);
        }

        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            return res.json(false);
        }

        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

        let decimals = 18;
        try {
            decimals = await tokenContract.decimals();
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 18. ${error.toString()}`);
        }

        const iface = new ethers.Interface([
            ...erc20Abi,
            ...transferEventAbi,
        ]);
        const tokenTransfers = [];

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) {
                continue;
            }

            try {
                const parsed = iface.parseLog(log);

                if (parsed.name !== 'Transfer') {
                    continue;
                }

                tokenTransfers.push({
                    hash: txHash,
                    from: parsed.args.from,
                    to: parsed.args.to,
                    value: ethers.formatUnits(parsed.args.value, decimals),
                    blockNumber: receipt.blockNumber,
                });
            } catch (error) {
                // Not a Transfer event for this token
            }
        }

        return res.json({
            tokenTransfers,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Get token transaction histories by block number
 */
api.post('/get-token-transfer-histories-by-block-number', async (req, res) => {
    try {
        if (!paidProvider) {
            return res.json(false);
        }

        const { fromBlockNumber, toBlockNumber, blockNumber } = req.body;
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);
        const range = parseBlockRange(fromBlockNumber, toBlockNumber, blockNumber);

        if (!tokenAddress || !range) {
            return res.json(false);
        }

        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, paidProvider);

        let decimals = 18;
        try {
            decimals = await tokenContract.decimals();
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 18. ${error.toString()}`);
        }

        const iface = new ethers.Interface(transferEventAbi);
        const transferTopic = ethers.id('Transfer(address,address,uint256)');

        const logs = await paidProvider.getLogs({
            address: tokenAddress,
            fromBlock: BigInt(range.from),
            toBlock: BigInt(range.to),
            topics: [transferTopic],
        });

        const transactions = logs.flatMap((log) => {
            try {
                const parsed = iface.parseLog(log);
                return [{
                    from: parsed.args.from,
                    to: parsed.args.to,
                    value: ethers.formatUnits(parsed.args.value, decimals),
                    blockNumber: Number(log.blockNumber),
                    hash: log.transactionHash,
                    transactionHash: log.transactionHash,
                }];
            } catch (error) {
                console.warn(`Log parsing failed: ${log.transactionHash}`);
                return [];
            }
        });

        const latestBlock = await paidProvider.getBlock('latest');
        const lastBlock = latestBlock && latestBlock.number > range.to
            ? range.to
            : Number(latestBlock?.number ?? range.to);

        return res.json({
            transactions,
            last_block: lastBlock,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

/**
 * Get native transfer histories by block number (single block or range)
 */
api.post('/get-native-transfer-histories-by-block-number', async (req, res) => {
    try {
        if (!paidRpcUrl) {
            return res.json(false);
        }

        const { blockNumber, fromBlockNumber, toBlockNumber } = req.body;
        const range = parseBlockRange(fromBlockNumber, toBlockNumber, blockNumber);

        if (!range) {
            return res.json(false);
        }

        const transactions = [];
        let lastBlock = range.to;
        const web3 = new Web3(paidRpcUrl);

        for (let blockNum = range.from; blockNum <= range.to; blockNum++) {
            try {
                const block = await web3.eth.getBlock(blockNum, true);

                if (!block || !block.transactions) {
                    lastBlock = blockNum;
                    return res.json({
                        transactions,
                        last_block: lastBlock,
                    });
                }

                const nativeTxs = block.transactions.filter(
                    (tx) => tx.input === '0x' && BigInt(tx.value) > 0n,
                );

                const decoded = nativeTxs.map((tx) => ({
                    from: tx.from,
                    to: tx.to,
                    value: ethers.formatEther(tx.value),
                    blockNumber: Number(tx.blockNumber),
                    hash: tx.hash,
                    timestamp: Number(block.timestamp),
                }));

                transactions.push(...decoded);
            } catch (err) {
                console.error(`Error fetching block ${blockNum}:`, err);
            }
        }

        return res.json({
            transactions,
            last_block: lastBlock,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
