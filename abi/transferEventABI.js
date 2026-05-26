module.exports = [
    {
        constant: false,
        inputs: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" }
        ],
        name: "Transfer",
        type: "event"
    }
];