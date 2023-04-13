const { getNamedAccounts, ethers, network } = require("hardhat");
const { assert, expect } = require("chai");
const { developmentChains } = require("../../helper-hardhat-config");


developmentChains.includes(network.name) ? describe.skip : describe("Raffle unit tests", function () {
    let raffle, raffleEntranceFee, deployer;

    beforeEach(async function () {
        deployer = (await getNamedAccounts()).deployer;
        raffle = await ethers.getContract("Raffle", deployer);
        raffleEntranceFee = await raffle.getEntranceFee();
    });

    describe("fulfillRandomWords", function () {
        it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
            // enter the raffle
            const startingTimeStamp = await raffle.getLastTimeStamp();
            const accounts = await ethers.getSigners();

            // set up listener just in case blockchain moves too fast
            await new Promise(async (resolve, reject) => {
                raffle.once("WinnerPicked", async () => {
                    console.log("WinnerPicked event fired !!");

                    try {
                        // add our asserts here
                        const recentWinner = await raffle.getRecentWinner();
                        const raffleState = await raffle.getRaffleState();
                        const winnerEndingBalance = await accounts[0].getBalance();
                        const endingTimeStamp = await raffle.getLastTimeStamp();

                        await expect(raffle.getPlayer(0)).to.be.reverted; // getPlayer(0) should be reverted because there will not be an object at player[0]
                        assert.equal(recentWinner.toString(), accounts[0].address) // this is our deployer
                        assert.equal(raffleState, 0); //we want the enum go back to open after we are done
                        assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(raffleEntranceFee).toString());
                        assert(endingTimeStamp > startingTimeStamp);
                        resolve();


                    } catch (error) {
                        console.log(error);
                        reject(error);
                    }
                })

                // then entering the raffle
                
                console.log("Entering Raffle...")
                const tx = await raffle.enterRaffle({ value: raffleEntranceFee })
                await tx.wait(1)
                console.log("Ok, time to wait...")
                const winnerStartingBalance = await accounts[0].getBalance() // needed for comparisons

                // This code won't complete untill our listener has stopped listening
            })

        })
    })
})


// Testing on a testnet :
// 1. Get our SubId for Chainlink VRF
// 2. Deploy our contract using the SubId
// 3. Register the contract with Chainlink VRF & it's subId
// 4. Register the contract with Chainlink Keepers
// 5. Run staging tests