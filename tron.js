require('dotenv').config();

const express = require('express');
const TronWeb = require('tronweb');

const fullHost = process.env.TRON_FULL_HOST;
const paidFullHost = process.env.TRON_PAID_FULL_HOST || fullHost;
const port = process.env.TRON_PORT || 5002;
const chainId = process.env.TRON_CHAIN_ID ? Number(process.env.TRON_CHAIN_ID) : null;
const maxBlockRange = Number(process.env.TRON_MAX_BLOCK_RANGE || 500);

if (!fullHost) {
    console.error('TRON_FULL_HOST environment variable is required');
    process.exit(1);
}

const tronWeb = new TronWeb({
    fullHost,
});

const paidTronWeb = paidFullHost ? new TronWeb({ fullHost: paidFullHost }) : null;

const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function normalizeAddress(address) {
    if (!address) {
        return null;
    }

    const trimmed = String(address).trim();

    try {
        if (tronWeb.isAddress(trimmed)) {
            return tronWeb.address.fromHex(tronWeb.address.toHex(trimmed));
        }
    } catch (error) {
        // invalid address
    }

    return null;
}

function normalizePrivateKey(privateKey) {
    if (!privateKey) {
        return null;
    }

    const trimmed = String(privateKey).trim().replace(/^0x/i, '');
    return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed : null;
}

function normalizeTxHash(txHash) {
    if (!txHash) {
        return null;
    }

    const trimmed = String(txHash).trim().replace(/^0x/i, '');
    return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed : null;
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

function walletFromPrivateKey(privateKey) {
    return new TronWeb({
        fullHost,
        privateKey,
    });
}

function decodeTopicAddress(topicHex) {
    // TRC-20 indexed address topic uses 32-byte hex, take last 20 bytes and add 0x41 prefix.
    const clean = topicHex.replace(/^0x/i, '').padStart(64, '0');
    const tronHex = `41${clean.slice(-40)}`;

    try {
        return tronWeb.address.fromHex(tronHex);
    } catch (error) {
        return null;
    }
}

function decodeTrc20Transfer(log, decimals) {
    const topics = log.topics || [];

    if (topics.length < 3 || topics[0].toLowerCase() !== TRANSFER_TOPIC) {
        return null;
    }

    const from = decodeTopicAddress(topics[1]);
    const to = decodeTopicAddress(topics[2]);
    const valueHex = log.data || '0x0';

    try {
        const valueRaw = BigInt(`0x${valueHex.replace(/^0x/i, '') || '0'}`);
        const divisor = 10n ** BigInt(decimals);
        const whole = valueRaw / divisor;
        const fraction = valueRaw % divisor;
        const fracStr = fraction.toString().padStart(Number(decimals), '0').replace(/0+$/, '');
        const value = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();

        return { from, to, value };
    } catch (error) {
        return null;
    }
}

async function getLatestBlockData(instance = tronWeb) {
    const block = await instance.trx.getCurrentBlock();
    if (!block || !block.blockID || !block.block_header) {
        return null;
    }

    const txCount = Array.isArray(block.transactions) ? block.transactions.length : 0;

    return {
        number: block.block_header.raw_data.number,
        hash: block.blockID,
        timestamp: Math.floor(block.block_header.raw_data.timestamp / 1000),
        transactionsCount: txCount,
    };
}

const app = express();
const api = express.Router();
app.use(express.json());
app.use('/api', api);

api.get('/check', (req, res) => {
    return res.json({
        message: '!! Hello World !!',
        rpcConfigured: Boolean(fullHost),
        paidRpcConfigured: Boolean(paidFullHost),
        chainId,
    });
});

api.post('/test-rpc', async (req, res) => {
    try {
        const latestBlock = await getLatestBlockData();
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

api.get('/generate-wallet', async (req, res) => {
    try {
        const wallet = await tronWeb.createAccount();
        return res.json({
            address: wallet.address.base58,
            privateKey: wallet.privateKey,
            mnemonic: null,
            publicKey: wallet.publicKey,
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

        const address = tronWeb.address.fromPrivateKey(privateKey);
        if (!address) {
            return res.json(false);
        }

        return res.json({
            address,
            privateKey,
            publicKey: null,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/check-address', async (req, res) => {
    try {
        return res.json(Boolean(normalizeAddress(req.body.address)));
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-native-balance', async (req, res) => {
    try {
        const address = normalizeAddress(req.body.address);
        if (!address) {
            return res.json(false);
        }

        const balanceSun = await tronWeb.trx.getBalance(address);
        return res.json({
            balance: tronWeb.fromSun(balanceSun),
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-token-balance', async (req, res) => {
    try {
        const address = normalizeAddress(req.body.address);
        const tokenAddress = normalizeAddress(req.body.tokenAddress);
        if (!address || !tokenAddress) {
            return res.json(false);
        }

        const contract = await tronWeb.contract().at(tokenAddress);
        const rawBalance = await contract.balanceOf(address).call();

        let decimals = 6;
        try {
            decimals = Number(await contract.decimals().call());
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 6. ${error.toString()}`);
        }

        const balanceBigInt = BigInt(rawBalance.toString());
        const divisor = 10n ** BigInt(decimals);
        const whole = balanceBigInt / divisor;
        const fraction = balanceBigInt % divisor;
        const fracStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');

        return res.json({
            balance: fracStr ? `${whole.toString()}.${fracStr}` : whole.toString(),
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/send-native-balance', async (req, res) => {
    try {
        const privateKey = normalizePrivateKey(req.body.privateKey);
        const toAddress = normalizeAddress(req.body.toAddress);
        const amount = parseAmount(req.body.amount);

        if (!privateKey || !toAddress || !amount) {
            return res.json(false);
        }

        const sender = walletFromPrivateKey(privateKey);
        const fromAddress = sender.address.fromPrivateKey(privateKey);
        const amountSun = sender.toSun(amount);
        const unsignedTx = await sender.transactionBuilder.sendTrx(toAddress, amountSun, fromAddress);
        const signedTx = await sender.trx.sign(unsignedTx, privateKey);
        const broadcast = await sender.trx.sendRawTransaction(signedTx);

        if (!broadcast.result) {
            return res.json(false);
        }

        return res.json({
            hash: broadcast.txid,
            from: fromAddress,
            to: toAddress,
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
        const tokenAddress = normalizeAddress(req.body.tokenAddress);
        const toAddress = normalizeAddress(req.body.toAddress);
        const amount = parseAmount(req.body.amount);

        if (!privateKey || !tokenAddress || !toAddress || !amount) {
            return res.json(false);
        }

        const sender = walletFromPrivateKey(privateKey);
        const fromAddress = sender.address.fromPrivateKey(privateKey);
        const contract = await sender.contract().at(tokenAddress);

        let decimals = 6;
        try {
            decimals = Number(await contract.decimals().call());
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 6. ${error.toString()}`);
        }

        const normalized = amount.includes('.') ? amount : `${amount}.0`;
        const [whole, fracRaw] = normalized.split('.');
        const frac = (fracRaw || '').slice(0, decimals).padEnd(decimals, '0');
        const rawAmount = (BigInt(whole || '0') * (10n ** BigInt(decimals))) + BigInt(frac || '0');

        const txHash = await contract.transfer(toAddress, rawAmount.toString()).send();

        return res.json({
            hash: txHash,
            from: fromAddress,
            to: toAddress,
            token: tokenAddress,
            amount,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.get('/get-latest-block', async (req, res) => {
    try {
        const blockData = await getLatestBlockData();
        if (!blockData) {
            return res.json(false);
        }

        return res.json(blockData);
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-latest-block', async (req, res) => {
    try {
        const blockData = await getLatestBlockData();
        if (!blockData) {
            return res.json(false);
        }

        return res.json(blockData);
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-native-transaction', async (req, res) => {
    try {
        const txHash = normalizeTxHash(req.body.txHash);
        if (!txHash) {
            return res.json(false);
        }

        const tx = await tronWeb.trx.getTransaction(txHash);
        const txInfo = await tronWeb.trx.getTransactionInfo(txHash);

        if (!tx || !tx.txID || !tx.raw_data || !tx.raw_data.contract || !tx.raw_data.contract[0]) {
            return res.json(false);
        }

        const contract = tx.raw_data.contract[0];
        const value = contract.parameter?.value || {};
        const amountSun = value.amount || 0;
        const fromHex = value.owner_address;
        const toHex = value.to_address;

        return res.json({
            hash: tx.txID,
            from: fromHex ? tronWeb.address.fromHex(fromHex) : null,
            to: toHex ? tronWeb.address.fromHex(toHex) : null,
            value: tronWeb.fromSun(amountSun),
            blockNumber: txInfo?.blockNumber ?? null,
        });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-token-transaction', async (req, res) => {
    try {
        const txHash = normalizeTxHash(req.body.txHash);
        const tokenAddress = normalizeAddress(req.body.tokenAddress);

        if (!txHash || !tokenAddress) {
            return res.json(false);
        }

        const txInfo = await tronWeb.trx.getTransactionInfo(txHash);
        if (!txInfo || !Array.isArray(txInfo.log)) {
            return res.json(false);
        }

        const contract = await tronWeb.contract().at(tokenAddress);
        let decimals = 6;
        try {
            decimals = Number(await contract.decimals().call());
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 6. ${error.toString()}`);
        }

        const tokenHex = tronWeb.address.toHex(tokenAddress).toLowerCase();
        const tokenTransfers = txInfo.log
            .filter((log) => (log.address || '').toLowerCase() === tokenHex)
            .map((log) => {
                const decoded = decodeTrc20Transfer(log, decimals);
                if (!decoded) {
                    return null;
                }

                return {
                    hash: txHash,
                    from: decoded.from,
                    to: decoded.to,
                    value: decoded.value,
                    blockNumber: txInfo.blockNumber ?? null,
                };
            })
            .filter(Boolean);

        return res.json({ tokenTransfers });
    } catch (error) {
        console.log(`${error.toString()}`);
        return res.json(false);
    }
});

api.post('/get-token-transfer-histories-by-block-number', async (req, res) => {
    try {
        const tokenAddress = normalizeAddress(req.body.tokenAddress);
        const range = parseBlockRange(req.body.fromBlockNumber, req.body.toBlockNumber, req.body.blockNumber);

        if (!tokenAddress || !range || !paidTronWeb) {
            return res.json(false);
        }

        const tokenHex = paidTronWeb.address.toHex(tokenAddress).toLowerCase();
        const contract = await paidTronWeb.contract().at(tokenAddress);
        let decimals = 6;
        try {
            decimals = Number(await contract.decimals().call());
        } catch (error) {
            console.log(`Warning: failed to fetch decimals, defaulting to 6. ${error.toString()}`);
        }

        const transactions = [];
        let lastBlock = range.to;

        for (let blockNum = range.from; blockNum <= range.to; blockNum++) {
            const block = await paidTronWeb.trx.getBlockByNumber(blockNum);
            if (!block || !Array.isArray(block.transactions)) {
                lastBlock = blockNum;
                break;
            }

            for (const tx of block.transactions) {
                const txHash = tx.txID;
                const txInfo = await paidTronWeb.trx.getTransactionInfo(txHash);
                if (!txInfo || !Array.isArray(txInfo.log)) {
                    continue;
                }

                for (const log of txInfo.log) {
                    if ((log.address || '').toLowerCase() !== tokenHex) {
                        continue;
                    }

                    const decoded = decodeTrc20Transfer(log, decimals);
                    if (!decoded) {
                        continue;
                    }

                    transactions.push({
                        from: decoded.from,
                        to: decoded.to,
                        value: decoded.value,
                        blockNumber: blockNum,
                        hash: txHash,
                        transactionHash: txHash,
                    });
                }
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

api.post('/get-native-transfer-histories-by-block-number', async (req, res) => {
    try {
        const range = parseBlockRange(req.body.fromBlockNumber, req.body.toBlockNumber, req.body.blockNumber);
        if (!range || !paidTronWeb) {
            return res.json(false);
        }

        const transactions = [];
        let lastBlock = range.to;

        for (let blockNum = range.from; blockNum <= range.to; blockNum++) {
            const block = await paidTronWeb.trx.getBlockByNumber(blockNum);
            if (!block || !Array.isArray(block.transactions)) {
                lastBlock = blockNum;
                break;
            }

            const timestamp = block.block_header?.raw_data?.timestamp
                ? Math.floor(block.block_header.raw_data.timestamp / 1000)
                : null;

            for (const tx of block.transactions) {
                const contract = tx.raw_data?.contract?.[0];
                if (!contract || contract.type !== 'TransferContract') {
                    continue;
                }

                const value = contract.parameter?.value || {};
                const amountSun = value.amount || 0;
                if (Number(amountSun) <= 0) {
                    continue;
                }

                transactions.push({
                    from: value.owner_address ? paidTronWeb.address.fromHex(value.owner_address) : null,
                    to: value.to_address ? paidTronWeb.address.fromHex(value.to_address) : null,
                    value: paidTronWeb.fromSun(amountSun),
                    blockNumber: blockNum,
                    hash: tx.txID,
                    timestamp,
                });
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
    console.log(`TRON server running at http://localhost:${port}`);
});
