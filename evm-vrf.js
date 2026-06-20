const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const drawVrfConsumerAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'abis/draw-vrf-consumer.json'), 'utf8'),
);

function normalizeBytes32(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const trimmed = String(value).trim();
    const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;

    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
        return null;
    }

    return withPrefix;
}

function parseDrawRandomnessRequested(receipt, contract) {
    for (const log of receipt.logs) {
        try {
            const parsed = contract.interface.parseLog(log);
            if (parsed?.name === 'DrawRandomnessRequested') {
                return {
                    productDrawId: parsed.args.productDrawId,
                    requestId: parsed.args.requestId.toString(),
                    requester: parsed.args.requester,
                };
            }
        } catch {
            // ignore unrelated logs
        }
    }

    return null;
}

module.exports = function registerVrfRoutes(api, helpers) {
    const { resolveChainProvider, normalizePrivateKey, normalizeHexAddress } = helpers;

    api.post('/vrf/request-draw', async (req, res) => {
        try {
            const privateKey = normalizePrivateKey(req.body.privateKey);
            const contractAddress = normalizeHexAddress(req.body.contractAddress);
            const productDrawId = normalizeBytes32(req.body.productDrawId);
            const productName = String(req.body.productName ?? '').trim();
            const ticketsRegistered = Number.parseInt(String(req.body.ticketsRegistered ?? ''), 10);
            const ticketsSold = Number.parseInt(String(req.body.ticketsSold ?? ''), 10);

            if (
                !privateKey
                || !contractAddress
                || !productDrawId
                || productName === ''
                || !Number.isFinite(ticketsRegistered)
                || ticketsRegistered <= 0
                || !Number.isFinite(ticketsSold)
                || ticketsSold > ticketsRegistered
            ) {
                return res.json(false);
            }

            const { provider } = await resolveChainProvider(req.body);

            if (!provider) {
                return res.json(false);
            }

            const wallet = new ethers.Wallet(privateKey, provider);
            const contract = new ethers.Contract(contractAddress, drawVrfConsumerAbi, wallet);
            const txResponse = await contract.requestDraw(
                productDrawId,
                productName,
                ticketsRegistered,
                ticketsSold,
            );
            const receipt = await txResponse.wait();
            const requested = parseDrawRandomnessRequested(receipt, contract);

            return res.json({
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                from: wallet.address,
                contractAddress,
                productDrawId,
                requestId: requested?.requestId ?? null,
                gasUsed: receipt.gasUsed?.toString() ?? null,
            });
        } catch (error) {
            console.log(`vrf/request-draw: ${error.toString()}`);
            return res.json(false);
        }
    });

    api.post('/vrf/draw-status', async (req, res) => {
        try {
            const contractAddress = normalizeHexAddress(req.body.contractAddress);
            const productDrawId = normalizeBytes32(req.body.productDrawId);
            let requestId = req.body.requestId !== undefined && req.body.requestId !== null
                ? String(req.body.requestId).trim()
                : null;

            if (!contractAddress || (!productDrawId && !requestId)) {
                return res.json(false);
            }

            const { provider } = await resolveChainProvider(req.body);

            if (!provider) {
                return res.json(false);
            }

            const contract = new ethers.Contract(contractAddress, drawVrfConsumerAbi, provider);

            if (!requestId && productDrawId) {
                const onChainRequestId = await contract.getRequestId(productDrawId);
                requestId = onChainRequestId.toString();
            }

            if (requestId === '0') {
                return res.json({
                    contractAddress,
                    productDrawId,
                    requestId: '0',
                    fulfilled: false,
                    randomWords: [],
                });
            }

            const fulfilled = await contract.requestFulfilled(requestId);
            const randomWords = fulfilled
                ? (await contract.getRandomWords(requestId)).map((word) => word.toString())
                : [];
            const mappedProductDrawId = productDrawId ?? await contract.requestDrawIds(requestId);

            const response = {
                contractAddress,
                productDrawId: mappedProductDrawId,
                requestId,
                fulfilled,
                randomWords,
            };

            if (fulfilled && mappedProductDrawId) {
                const record = await contract.drawRecords(mappedProductDrawId);

                response.drawRecord = {
                    productName: record.productName,
                    ticketsRegistered: Number(record.ticketsRegistered),
                    ticketsSold: Number(record.ticketsSold),
                    randomWord: record.randomWord.toString(),
                    winnerTicketIndex: Number(record.winnerTicketIndex),
                    winnerTicketNumber: Number(record.winnerTicketNumber),
                    fulfilled: record.fulfilled,
                };
            }

            return res.json(response);
        } catch (error) {
            console.log(`vrf/draw-status: ${error.toString()}`);
            return res.json(false);
        }
    });
};
