const { assert, expect } = require("chai")
const { deployments, ethers, getNamedAccounts } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("FundMe", async function () {
          let fundMe
          let deployer
          let owner
          let funder
          let others
          let mockV3Aggregator
          const sendValue = ethers.utils.parseEther("1")
          beforeEach(async function () {
              // owner, funder .. are local accounts managed by HardHat, pre-financed with ETH so
              // they can be used when testing. getSigners() returns an array of theses accounts objects.
              ;[owner, funder, ...others] = await ethers.getSigners()

              // getNamedAccounts() uses the namedAccounts object from our hardhat.config.js to return
              // an address provided by Hardhat (to see all addresses, CLI yarn hardhat node)
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])

              // getContract() returns an instance of a contract, which means we can call and use
              // all of its methods and variables. The params are the contract's name and the address of the deployer/owner.
              fundMe = await ethers.getContract("FundMe", deployer)
              mockV3Aggregator = await ethers.getContract(
                  "MockV3Aggregator",
                  deployer
              )
          })

          describe("Constructor", async function () {
              it("Sets the aggregator addresses correctly", async function () {
                  // We can retrieve the value of the priceFeed variable of the FundMe contract.
                  const response = await fundMe.getPriceFeed()
                  // Then check if it matches the address of our deployed mock Price Feed contract
                  assert.equal(response, mockV3Aggregator.address)
              })
          })

          describe("Fund", async function () {
              it("fails if you don't send enough ETH", async function () {
                  await expect(fundMe.fund()).to.be.revertedWith(
                      "You need to spend more ETH!"
                  )
              })
              it("update the amount funded data structure", async function () {
                  await fundMe.fund({ value: sendValue })
                  const response = await fundMe.getAddressToAmountFunded(
                      deployer
                  )
                  assert.equal(response.toString(), sendValue.toString())
              })
              it("adds funder to array of getFunder", async function () {
                  await fundMe.fund({ value: sendValue })
                  const firstFunder = await fundMe.getFunder(0)
                  assert.equal(firstFunder, deployer)
              })
          })

          describe("Withdraw", async function () {
              // To test the withdraw function we need to be sure it starts with some ETH.
              beforeEach(async function () {
                  await fundMe.fund({ value: sendValue })
              })

              it("withdraw ETH from a single founder", async function () {
                  // Arrange
                  // We get the starting balance of the contract
                  //( should be = sendvalue because of beforeEach )
                  // .provider.getBalance(contract.address) gives us the balance of any contract.
                  const startingFundMeBalance =
                      await fundMe.provider.getBalance(fundMe.address)
                  // We get the starting balance of the deployer/owner
                  const startingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Act
                  // We call withdraw
                  const transactionReponse = await fundMe.withdraw()
                  // We wait a block confirmation
                  const transactionReceipt = await transactionReponse.wait(1)
                  // We can pull out the gas used and its price from the transactionReceipt object.
                  const { gasUsed, effectiveGasPrice } = transactionReceipt
                  // We use .mul to multiply, as we're dealing with BigNumbers.
                  const gasCost = gasUsed.mul(effectiveGasPrice)
                  // We get the contract's balance post-withdraw
                  const endingFundMeBalance = await fundMe.provider.getBalance(
                      fundMe.address
                  )
                  // We get the deployer's balance post-withdraw
                  const endingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Assert
                  // The contract's balance should now be 0 after withdrawing all funds.
                  assert.equal(endingFundMeBalance, 0)
                  assert.equal(
                      // If we add the starting value of the contract to the starting balance of the deployer
                      // it should equal to the ending balance of the deployer (contract => ~funds => deployer)
                      startingFundMeBalance
                          .add(startingDeployerBalance)
                          .toString(),
                      endingDeployerBalance.add(gasCost).toString()
                  )
              })
              it("allows us to withdraw with multiple getFunder", async function () {
                  // Arrange
                  const accounts = await ethers.getSigners()
                  for (let i = 1; i < 6; i++) {
                      const fundMeConnectedContract = await fundMe.connect(
                          accounts[i]
                      )
                      await fundMeConnectedContract.fund({ value: sendValue })
                  }
                  const startingFundMeBalance =
                      await fundMe.provider.getBalance(fundMe.address)
                  const startingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Act
                  const transactionReponse = await fundMe.withdraw()
                  const transactionReceipt = await transactionReponse.wait(1)
                  const { gasUsed, effectiveGasPrice } = transactionReceipt
                  const gasCost = gasUsed.mul(effectiveGasPrice)
                  const endingFundMeBalance = await fundMe.provider.getBalance(
                      fundMe.address
                  )
                  const endingDeployerBalance =
                      await fundMe.provider.getBalance(deployer)

                  // Assert
                  assert.equal(endingFundMeBalance, 0)
                  assert.equal(
                      startingFundMeBalance
                          .add(startingDeployerBalance)
                          .toString(),
                      endingDeployerBalance.add(gasCost).toString()
                  )

                  // Make sure that the getFunder get reset properly
                  await expect(fundMe.getFunder(0)).to.be.reverted
                  for (i = 1; i < 6; i++) {
                      assert.equal(
                          await fundMe.getAddressToAmountFunded(
                              accounts[i].address
                          ),
                          0
                      )
                  }
              })
              it("Only allows the owner to withdraw", async function () {
                  const accounts = await ethers.getSigners()
                  const attacker = accounts[1]
                  const attackerConnectedContract = await fundMe.connect(
                      attacker
                  )
                  await expect(
                      attackerConnectedContract.withdraw()
                  ).to.be.revertedWith("FundMe__NotOwner")
              })
          })

          //***********************************
          //*       Optional testing          *
          //*    Receive() and fallback()     *
          //*    ( not in the course )        *
          //***********************************

          describe("receive() and fallback()", function () {
              it("should fund the contract with receive()", async function () {
                  // We initialize the inital balance by using the mapping from our contract :
                  // As this mapping expects an address to output an amount, we feed it the funder's address.
                  // -> fundMe.getAddressToAmountFunded(address)
                  const initialBalance = await fundMe.getAddressToAmountFunded(
                      funder.address
                  )
                  // ethers.utils.parseEther(value) will convert ETH amount into Wei.
                  const fundingAmount = ethers.utils.parseEther("1")

                  // sendTransaction() from ethers.js is a method available on Signer objects.
                  // It simulates the sending of a tx to a given address, here the fundMe contract's address.
                  await funder.sendTransaction({
                      to: fundMe.address,
                      value: fundingAmount,
                  })

                  const finalBalance = await fundMe.getAddressToAmountFunded(
                      funder.address
                  )
                  expect(finalBalance).to.equal(
                      initialBalance.add(fundingAmount)
                  )
              })

              it("should fund the contract with fallback()", async function () {
                  const initialBalance = await fundMe.getAddressToAmountFunded(
                      funder.address
                  )

                  const fundingAmount = ethers.utils.parseEther("1")
                  await funder.sendTransaction({
                      to: fundMe.address,
                      value: fundingAmount,
                      data: "0x", // This will trigger the fallback() function
                  })

                  const finalBalance = await fundMe.getAddressToAmountFunded(
                      funder.address
                  )
                  expect(finalBalance).to.equal(
                      initialBalance.add(fundingAmount)
                  )
              })
          })
      })
