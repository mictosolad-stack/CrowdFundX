// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {console} from "forge-std/console.sol";
import {Script} from "forge-std/Script.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";

contract DeployCrowdfunding is Script {
    function run() external {
        // Get the private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Start broadcasting transactions with the deployer's private key
        vm.startBroadcast(deployerPrivateKey);

        // Deploy the Crowdfunding contract
        Crowdfunding crowdfunding = new Crowdfunding();

        // Log deployment information
        console.log("Crowdfunding deployed to:", address(crowdfunding));
        console.log("Deployer:", msg.sender);

        // Stop broadcasting
        vm.stopBroadcast();
    }
}
