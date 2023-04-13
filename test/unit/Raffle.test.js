const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { assert, expect } = require("chai");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name) ? describe.skip : describe("Raffle unit tests", async function () {
    let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
    const chainId = network.config.chainId;

    beforeEach(async function () {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        raffle = await ethers.getContract("Raffle", deployer);
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
        raffleEntranceFee = await raffle.getEntranceFee();
        interval = await raffle.getInterval();
    });

    describe("constructor", async function () {
        it("initializes the raffle correctly", async function () {
            // Ideally we make our tests have 1 assert per "it"
            const raffleState = await raffle.getRaffleState();  // so that we ensure that we start in an open raffle state. raffleState here is a bigNumber
            assert.equal(raffleState.toString(), "0");  // we are stringifying raffleState
            assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        })
    })

    describe("enterRaffle", async function () {
        it("reverts when you don't pay enough", async function () {
            await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered");
        })

        it("records players when they enter", async function () {
            await raffle.enterRaffle({ value: raffleEntranceFee });
            const playerFromContract = await raffle.getPlayer(0);
            assert.equal(playerFromContract, deployer);
        })

        it("emits event on enter", async function () {
            await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(raffle, "RaffleEnter");  // checking for an emit is similar to checking for an error
        })

        it("doesn't allow entrance when raffle is calculating", async function () {
            await raffle.enterRaffle({ value: raffleEntranceFee });
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);  // increase the time by whatever our interval is to make sure that we get checkUpkeep to return true
            await network.provider.send("evm_mine", []) // we want to mine it one extra block

            // Now we will pretend to be a Chainlink Keeper
            await raffle.performUpkeep([]);  // now raffle should be in calculating state
            await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith("Raffle__NotOpen");
        })
    })

    describe("checkUpkeep", async function () {
        it("returns false if people haven't sent any ETH", async function () {
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);  // increase the time by whatever our interval is to make sure that we get checkUpkeep to return true
            await network.provider.send("evm_mine", []) // we want to mine it one extra block

            // Callstatic
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // if we run raffle.checkUpkeep([]), this will kick off a transaction but we do not want to send a transaction. We use callStatic to simulate a transaction and see what checkUpkeep will return
            // const { upkeepNeeded } extrapolates just upkeepNeeded from checkUpkeep
            assert(!upkeepNeeded);  // upkeepNeeded should return false so !(false) = true
        })

        it("returns false if raffle is not open", async function () {
            await raffle.enterRaffle({ value: raffleEntranceFee });
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);  // increase the time by whatever our interval is to make sure that we get checkUpkeep to return true
            await network.provider.send("evm_mine", []) // we want to mine it one extra block
            await raffle.performUpkeep([]);
            const raffleState = await raffle.getRaffleState();
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
            assert.equal(raffleState.toString(), "1");
            assert.equal(upkeepNeeded, false);
        })

        it("returns false if enough time hasn't passed", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
            assert(!upkeepNeeded)
        })

        it("returns true if enough time has passed, has players, eth, and is open", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
            assert(upkeepNeeded)
        })
    })

    describe("performUpkeep", function(){
        it("performUpkeep can only run if checkUpkeep is true", async function(){
            await raffle.enterRaffle({value:raffleEntranceFee});
            await network.provider.send("evm_increaseTime",[interval.toNumber() +1]);
            await network.provider.send("evm_mine",[]);
            const tx= await raffle.performUpkeep([]);
            assert(tx);  // if tx does not work, this assert would fail
        })

        it("reverts when checkUpkeep is false", async function(){
            await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded");

        })

        it("updates the raffle state, emits an event, and calls the vrf coordinator", async function(){
            await raffle.enterRaffle({ value: raffleEntranceFee });
            await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
            await network.provider.send("evm_mine", []);
            const txResponse = await raffle.performUpkeep([]);
            const txReceipt = await txResponse.wait(1);
            const requestId = txReceipt.events[1].args.requestId;
            const raffleState = await raffle.getRaffleState();
            assert(requestId.toNumber()>0);
            assert(raffleState.toString()=="1");
        })
    })

    describe("fulfillRandomWords", function(){
        // we will put a beforeEach() because we want to have somebody enter the raffle before we run the test
        beforeEach(async function(){
            await raffle.enterRaffle({value:raffleEntranceFee}); // someone enters the raffle
            await network.provider.send("evm_increaseTime", [interval.toNumber()+1]); // we increase time
            await network.provider.send("evm_mine",[]); // we mined a new block
        })
        it("it can only be called after performUpkeep", async function(){
            // we are checking with 2 requestId's that do not exist
            await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0,raffle.address)).to.be.revertedWith("nonexistent request");
            await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith("nonexistent request");
        })

        // this is going to be a test that puts everything together
        it("picks a winner, resets the lottery and sends money", async function(){
            const additionalEntrants = 3; // we are having some more people enter the lottery
            const startingAccountIndex = 2; // since deployer is 0, we are going to have new accounts start from 1
            const accounts = await ethers.getSigners();
            for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++){
                // we are doing a loop and connect our raffle contract to these new accounts, and then we are going to have these new accounts enter our raffle contest
                const accountConnectedRaffle = raffle.connect(accounts[i]);
                await accountConnectedRaffle.enterRaffle({value:raffleEntranceFee});
            }

            const startingTimeStamp = await raffle.getLastTimeStamp(); // keeping note of our starting timestamp

            // performUpkeep (mock being chainlink keepers)
            // the above will kickoff calling fulfillRandomWords() (mock being the chainlink vrf)
            // we will have to wait for fulfillRandomWords() to be called
            // In order for us to simulate waiting for that event, we need to set up a listener
            // If we set up a listener, we do not want the test to finish before the listener is done listening
            // so we need to create a new promise

            await new Promise(async(resolve,reject)=>{
                // Setting up the listener
                raffle.once("WinnerPicked", async () => {
                    console.log("Found the event !!");
                    
                    try{
                        const recentWinner = await raffle.getRecentWinner();
                        // console.log(recentWinner);
                        // console.log(accounts[0].address);
                        // console.log(accounts[1].address);
                        // console.log(accounts[2].address);
                        // console.log(accounts[3].address);
                        
                        const raffleState = await raffle.getRaffleState();
                        const endingTimeStamp = await raffle.getLastTimeStamp();
                        const numPlayers = await raffle.getNumberOfPlayers();
                        const winnerEndingBalance = await accounts[2].getBalance(); // name is self explanatory

                        assert.equal(numPlayers.toString(), "0"); // there should be 0 players in raffle
                        assert.equal(raffleState.toString(), "0"); // raffle should be back open
                        assert(endingTimeStamp > startingTimeStamp); // last time stamp should be updated

                        assert.equal(
                            winnerEndingBalance.toString(),
                            winnerStartingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                .add(
                                    raffleEntranceFee
                                        .mul(additionalEntrants)
                                        .add(raffleEntranceFee)
                                )
                                .toString()
                        );
                        
                    } catch(e) {
                        reject(e);
                    }
                    resolve();
                })
                

                // We will fire the event and the listener will pick it up and resolve
                const tx = await raffle.performUpkeep([]);
                const txReceipt = await tx.wait(1);
                const winnerStartingBalance = await accounts[2].getBalance(); // winner's starting balance
                await vrfCoordinatorV2Mock.fulfillRandomWords(txReceipt.events[1].args.requestId, raffle.address);

            })
        })
    })
})