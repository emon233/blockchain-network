require('dotenv').config();

const Web3Module = require('web3');
const Web3 = Web3Module.Web3;

const express = require('express');
const { ethers, Wallet } = require('ethers');

const defaultRpcUrl = process.env.EVM_RPC_URL || null;
const defaultPaidRpcUrl = process.env.EVM_PAID_RPC_URL || null;
const defaultChainId = process.env.EVM_CHAIN_ID ? Number(process.env.EVM_CHAIN_ID) : null;
const port = process.env.EVM_PORT || 5000;
const maxBlockRange = Number(process.env.EVM_MAX_BLOCK_RANGE || 2000);
const maxTopicAddresses = Number(process.env.EVM_MAX_TOPIC_ADDRESSES || 50);

if (!defaultRpcUrl) {
    console.warn('EVM_RPC_URL is not set; requests must include rpcUrl (e.g. from Laravel).');
}

if (!defaultPaidRpcUrl) {
    console.warn('EVM_PAID_RPC_URL is not set; block history may use rpcUrl or request paidRpcUrl.');
}

const providerCache = new Map();
const web3Cache = new Map();

const erc20Abi = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
];

const transferEventAbi = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
];

function resolveChainConfig(source = {}) {
    const rpcUrl = source.rpcUrl || source.rpc || defaultRpcUrl || null;
    const paidRpcUrl = source.paidRpcUrl || source.paidRpc || source.prpcUrl || source.prpc || defaultPaidRpcUrl || rpcUrl;
    const chainIdRaw = source.chainId ?? defaultChainId;
    const chainId = chainIdRaw !== null && chainIdRaw !== undefined && chainIdRaw !== ''
        ? Number(chainIdRaw)
        : null;

    return { rpcUrl, paidRpcUrl, chainId };
}

function getProvider(rpcUrl) {
    if (!rpcUrl) {
        return null;
    }

    if (!providerCache.has(rpcUrl)) {
        providerCache.set(rpcUrl, new ethers.JsonRpcProvider(rpcUrl));
    }

    return providerCache.get(rpcUrl);
}

function getWeb3(rpcUrl) {
    if (!rpcUrl) {
        return null;
    }

    if (!web3Cache.has(rpcUrl)) {
        web3Cache.set(rpcUrl, new Web3(rpcUrl));
    }

    return web3Cache.get(rpcUrl);
}

async function assertChainId(provider, expectedChainId) {
    if (expectedChainId === null || expectedChainId === undefined || Number.isNaN(expectedChainId)) {
        return true;
    }

    const network = await provider.getNetwork();

    return Number(network.chainId) === Number(expectedChainId);
}

function normalizeHexAddress(address) {
    if (address === undefined || address === null) {
        return null;
    }

    const trimmed = String(address).trim();
    const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;

    return ethers.isAddress(withPrefix) ? ethers.getAddress(withPrefix) : null;
}

function normalizeHexAddressList(addresses) {
    if (addresses === undefined || addresses === null) {
        return [];
    }

    const list = Array.isArray(addresses) ? addresses : [addresses];
    const normalized = new Map();

    for (const entry of list) {
        const address = normalizeHexAddress(entry);

        if (address) {
            normalized.set(address.toLowerCase(), address);
        }
    }

    return [...normalized.values()];
}

function chunkArray(items, chunkSize) {
    if (chunkSize < 1) {
        return [items];
    }

    const chunks = [];

    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }

    return chunks;
}

function buildTransferRecipientTopics(transferTopic, toAddresses) {
    const topics = [transferTopic, null];

    if (!toAddresses || toAddresses.length === 0) {
        return topics;
    }

    const paddedTopics = toAddresses.map((address) => ethers.zeroPadValue(address, 32));
    topics.push(paddedTopics.length === 1 ? paddedTopics[0] : paddedTopics);

    return topics;
}

async function getTokenTransferLogs(paidProvider, tokenAddress, fromBlock, toBlock, toAddresses = []) {
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const addressChunks = toAddresses.length === 0
        ? [[]]
        : chunkArray(toAddresses, maxTopicAddresses);
    const seen = new Set();
    const logs = [];

    for (const chunk of addressChunks) {
        const topics = buildTransferRecipientTopics(transferTopic, chunk);
        const chunkLogs = await paidProvider.getLogs({
            address: tokenAddress,
            fromBlock: BigInt(fromBlock),
            toBlock: BigInt(toBlock),
            topics,
        });

        for (const log of chunkLogs) {
            const key = `${log.transactionHash}:${log.index}`;

            if (!seen.has(key)) {
                seen.add(key);
                logs.push(log);
            }
        }
    }

    return logs;
}

function parseTokenTransferLogs(logs, iface, decimals) {
    return logs.flatMap((log) => {
        try {
            const parsed = iface.parseLog(log);

            return [{
                from: parsed.args.from,
                to: parsed.args.to,
                value: ethers.formatUnits(parsed.args.value, decimals),
                blockNumber: Number(log.blockNumber),
                hash: log.transactionHash,
                transactionHash: log.transactionHash,
                logIndex: log.index,
            }];
        } catch (error) {
            console.warn(`Log parsing failed: ${log.transactionHash}`);
            return [];
        }
    });
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

async function fetchLatestBlockData(blockProvider) {
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

async function resolveChainProvider(source = {}) {
    const chain = resolveChainConfig(source);
    const provider = getProvider(chain.rpcUrl);

    if (!provider) {
        return { chain, provider: null, paidProvider: null };
    }

    if (!(await assertChainId(provider, chain.chainId))) {
        throw new Error(`Chain ID mismatch: expected ${chain.chainId}`);
    }

    const paidProvider = getProvider(chain.paidRpcUrl);

    return { chain, provider, paidProvider };
}

const app = express();
const api = express.Router();
app.use(express.json());
app.use('/api', api);

api.get('/check', (req, res) => {
    const chain = resolveChainConfig(req.query);

    return res.json({
        message: '!! Hello World !!',
        hybrid: true,
        rpcConfigured: Boolean(chain.rpcUrl),
        paidRpcConfigured: Boolean(chain.paidRpcUrl),
        chainId: chain.chainId,
    });
});

api.post('/test-rpc', async (req, res) => {
    try {
        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
            return res.json(false);
        }

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

api.post('/get-address-from-public-key', async (req, res) => {
    try {
        const publicKey = normalizePublicKey(req.body.publicKey);

        if (!publicKey) {
            return res.json(false);
        }

        const address = ethers.computeAddress(publicKey);

        return res.json({ address });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/check-address', async (req, res) => {
    try {
        const address = normalizeHexAddress(req.body.address);
        
        return res.json({ isValid: Boolean(address) });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-native-balance', async (req, res) => {
    try {
        const address = normalizeHexAddress(req.body.address);

        if (!address) {
            return res.json(false);
        }

        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
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

api.post('/get-token-balance', async (req, res) => {
    try {
        const address = normalizeHexAddress(req.body.address);
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);

        if (!address || !tokenAddress) {
            return res.json(false);
        }

        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
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

api.post('/send-native-balance', async (req, res) => {
    try {
        const privateKey = normalizePrivateKey(req.body.privateKey);
        const toAddress = normalizeHexAddress(req.body.toAddress);
        const amount = parseAmount(req.body.amount);

        if (!privateKey || !toAddress || !amount) {
            return res.json(false);
        }

        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
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

api.post('/send-token-balance', async (req, res) => {
    try {
        const privateKey = normalizePrivateKey(req.body.privateKey);
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);
        const toAddress = normalizeHexAddress(req.body.toAddress);
        const amount = parseAmount(req.body.amount);

        if (!privateKey || !tokenAddress || !toAddress || !amount) {
            return res.json(false);
        }

        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
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

async function handleLatestBlock(req, res) {
    try {
        const source = req.method === 'GET' ? req.query : req.body;
        const { provider } = await resolveChainProvider(source);

        if (!provider) {
            return res.json(false);
        }

        const blockData = await fetchLatestBlockData(provider);

        if (!blockData) {
            return res.json(false);
        }

        return res.json(blockData);
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
}

api.get('/get-latest-block', handleLatestBlock);
api.post('/get-latest-block', handleLatestBlock);

api.post('/get-native-transaction', async (req, res) => {
    try {
        const txHash = normalizeTxHash(req.body.txHash);

        if (!txHash) {
            return res.json(false);
        }

        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
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

api.post('/get-token-transaction', async (req, res) => {
    try {
        const txHash = normalizeTxHash(req.body.txHash);
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);

        if (!txHash || !tokenAddress) {
            return res.json(false);
        }

        const { provider } = await resolveChainProvider(req.body);

        if (!provider) {
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
                    logIndex: log.index,
                });
            } catch (error) {
                // Not a Transfer event for this token
            }
        }

        return res.json({ tokenTransfers });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-token-transfer-histories-by-block-number', async (req, res) => {
    try {
        const { paidProvider } = await resolveChainProvider(req.body);

        if (!paidProvider) {
            return res.json(false);
        }

        const { fromBlockNumber, toBlockNumber, blockNumber } = req.body;
        const tokenAddress = normalizeHexAddress(req.body.tokenAddress);
        const range = parseBlockRange(fromBlockNumber, toBlockNumber, blockNumber);
        const rawToAddresses = req.body.toAddresses;
        const hasToAddressFilter = rawToAddresses !== undefined
            && rawToAddresses !== null
            && (Array.isArray(rawToAddresses) ? rawToAddresses.length > 0 : String(rawToAddresses).trim() !== '');
        const toAddresses = normalizeHexAddressList(rawToAddresses);

        if (!tokenAddress || !range) {
            return res.json(false);
        }

        if (hasToAddressFilter && toAddresses.length === 0) {
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

        const logs = await getTokenTransferLogs(
            paidProvider,
            tokenAddress,
            range.from,
            range.to,
            toAddresses,
        );

        const transactions = parseTokenTransferLogs(logs, iface, decimals);

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

api.post('/get-native-transfer-histories-by-block-number', async (req, res) => {
    try {
        const chain = resolveChainConfig(req.body);

        if (!chain.paidRpcUrl) {
            return res.json(false);
        }

        const { blockNumber, fromBlockNumber, toBlockNumber } = req.body;
        const range = parseBlockRange(fromBlockNumber, toBlockNumber, blockNumber);

        if (!range) {
            return res.json(false);
        }

        const transactions = [];
        let lastBlock = range.to;
        const web3 = getWeb3(chain.paidRpcUrl);

        if (!web3) {
            return res.json(false);
        }

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

require('./evm-vrf')(api, {
    resolveChainProvider,
    normalizePrivateKey,
    normalizeHexAddress,
});

app.listen(port, process.env.EVM_BIND_HOST || '127.0.0.1', () => {
    console.log(`Server running at http://${process.env.EVM_BIND_HOST || '127.0.0.1'}:${port}`);
});
