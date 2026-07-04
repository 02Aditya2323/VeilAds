import { task, types } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

/**
 * Deploy the VeilAds contract to the selected network.
 *
 * Usage:
 *   npx hardhat deploy-veilads --network eth-sepolia
 *
 * Optional flags:
 *   --verify      Run Etherscan verification after deploy (requires ETHERSCAN_API_KEY in .env)
 *
 * The deployed address is saved to:
 *   deployments/{network}.json  → { "VeilAds": "0x..." }
 *
 * Notes for Ethereum Sepolia (eth-sepolia):
 *   - Network is auto-injected by @cofhe/hardhat-plugin using SEPOLIA_RPC_URL + PRIVATE_KEY from .env
 *   - VeilAds constructor takes no arguments — just needs ETH to pay gas
 *   - CoFHE infrastructure (TaskManager, ACL, ThresholdNetwork) is already deployed on Sepolia by Fhenix;
 *     the contract uses them via fixed addresses in @fhenixprotocol/cofhe-contracts/FHE.sol
 */
task('deploy-veilads', 'Deploy the VeilAds contract to the selected network')
	.addFlag('verify', 'Verify the contract on Etherscan after deployment')
	.setAction(async (args: { verify: boolean }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`\n=== VeilAds Deployment ===`)
		console.log(`Network:  ${network.name}`)
		console.log(`Chain ID: ${(await ethers.provider.getNetwork()).chainId}`)

		// Deployer account
		const [deployer] = await ethers.getSigners()
		const balance = await ethers.provider.getBalance(deployer.address)
		console.log(`Deployer: ${deployer.address}`)
		console.log(`Balance:  ${ethers.formatEther(balance)} ETH`)

		if (balance === 0n) {
			throw new Error(
				`Deployer account has 0 ETH. Fund ${deployer.address} on ${network.name} before deploying.`
			)
		}

		// Estimate deploy cost before submitting tx
		console.log(`\nEstimating gas...`)
		const VeilAdsFactory = await ethers.getContractFactory('VeilAds')
		const deployTx = await VeilAdsFactory.getDeployTransaction()
		const gasEstimate = await ethers.provider.estimateGas(deployTx)
		const feeData = await ethers.provider.getFeeData()
		const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n
		const estimatedCost = gasEstimate * gasPrice
		console.log(`Gas estimate: ${gasEstimate.toString()}`)
		console.log(`Est. cost:    ${ethers.formatEther(estimatedCost)} ETH`)

		if (balance < estimatedCost) {
			throw new Error(
				`Insufficient balance. Need ~${ethers.formatEther(estimatedCost)} ETH, have ${ethers.formatEther(balance)} ETH.`
			)
		}

		// Deploy
		console.log(`\nDeploying VeilAds...`)
		const veilAds = await VeilAdsFactory.deploy()
		console.log(`Tx hash: ${veilAds.deploymentTransaction()?.hash}`)
		console.log(`Waiting for confirmation...`)

		await veilAds.waitForDeployment()
		const contractAddress = await veilAds.getAddress()

		console.log(`\n✅ VeilAds deployed to: ${contractAddress}`)

		// Save the deployment address
		saveDeployment(network.name, 'VeilAds', contractAddress)

		// Etherscan verification (optional, pass --verify flag)
		if (args.verify) {
			console.log(`\nVerifying on Etherscan...`)
			// VeilAds has no constructor args, so no constructorArguments needed
			try {
				await hre.run('verify:verify', {
					address: contractAddress,
					constructorArguments: [],
				})
				console.log(`✅ Verified on Etherscan`)
			} catch (err: unknown) {
				if (err instanceof Error && err.message.includes('Already Verified')) {
					console.log(`Contract already verified.`)
				} else {
					console.warn(`Verification failed (non-fatal): ${err instanceof Error ? err.message : err}`)
					console.warn(`You can manually verify later with:`)
					console.warn(
						`  npx hardhat verify --network ${network.name} ${contractAddress}`
					)
				}
			}
		} else {
			console.log(`\nTo verify on Etherscan, run:`)
			console.log(`  npx hardhat verify --network ${network.name} ${contractAddress}`)
		}

		console.log(`\n=== Deployment Summary ===`)
		console.log(`Contract:   VeilAds`)
		console.log(`Address:    ${contractAddress}`)
		console.log(`Network:    ${network.name}`)
		console.log(`Deployer:   ${deployer.address}`)
		console.log(`Tx hash:    ${veilAds.deploymentTransaction()?.hash}`)
		console.log(`Saved to:   deployments/${network.name}.json`)

		return contractAddress
	})
