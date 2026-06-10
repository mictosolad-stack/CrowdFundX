// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Crowdfunding} from "../src/Crowdfunding.sol";

contract CrowdfundingTest is Test {
    Crowdfunding public crowdfunding;
    address owner;
    address alice;
    address bob;

    function setUp() public {
        owner = address(this);
        alice = address(0x1);
        bob = address(0x2);

        // Fund test addresses
        vm.deal(owner, 10 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        crowdfunding = new Crowdfunding();
    }

    // ============ Campaign Creation Tests ============

    function test_CreateCampaign() public {
        uint256 goal = 2 ether;
        uint256 deadline = block.timestamp + 7 days;

        vm.expectEmit(true, true, false, true);
        emit Crowdfunding.CampaignCreated(1, owner, goal, deadline);

        crowdfunding.createCampaign("Build a school", "Help us build a school", goal, deadline);

        (address campaignOwner, string memory title, string memory description, uint256 campaignGoal, uint256 campaignDeadline, uint256 raised, bool withdrawn, address[] memory contributors) = crowdfunding.getCampaign(1);

        assertEq(campaignOwner, owner);
        assertEq(title, "Build a school");
        assertEq(description, "Help us build a school");
        assertEq(campaignGoal, goal);
        assertEq(campaignDeadline, deadline);
        assertEq(raised, 0);
        assertEq(withdrawn, false);
        assertEq(contributors.length, 0);
    }

    function test_CannotCreateCampaignWithZeroGoal() public {
        uint256 deadline = block.timestamp + 7 days;

        vm.expectRevert("Goal must be greater than 0");
        crowdfunding.createCampaign("Invalid campaign", "No goal", 0, deadline);
    }

    function test_CannotCreateCampaignWithPastDeadline() public {
        uint256 goal = 1 ether;
        uint256 pastDeadline = block.timestamp - 1 days;

        vm.expectRevert("Deadline must be in the future");
        crowdfunding.createCampaign("Past deadline", "Invalid", goal, pastDeadline);
    }

    // ============ Donation Tests ============

    function test_DonateToActiveCampaign() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Feed kids", "Donate to meals", goal, deadline);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Crowdfunding.DonationReceived(1, alice, 0.3 ether);
        crowdfunding.donate{value: 0.3 ether}(1);

        (address campaignOwner, , , , , uint256 raised, , ) = crowdfunding.getCampaign(1);
        assertEq(raised, 0.3 ether);

        uint256 contribution = crowdfunding.getContribution(1, alice);
        assertEq(contribution, 0.3 ether);
    }

    function test_MultipleDonationsSameUser() public {
        uint256 goal = 2 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Build a bridge", "Infrastructure", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 0.5 ether}(1);

        vm.prank(alice);
        crowdfunding.donate{value: 0.5 ether}(1);

        uint256 contribution = crowdfunding.getContribution(1, alice);
        assertEq(contribution, 1 ether);

        (address campaignOwner, , , , , uint256 raised, , ) = crowdfunding.getCampaign(1);
        assertEq(raised, 1 ether);
    }

    function test_MultipleDonorsToSameCampaign() public {
        uint256 goal = 2 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Build a library", "Education", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 0.5 ether}(1);

        vm.prank(bob);
        crowdfunding.donate{value: 1 ether}(1);

        (address campaignOwner, , , , , uint256 raised, , address[] memory contributors) = crowdfunding.getCampaign(1);
        assertEq(raised, 1.5 ether);
        assertEq(contributors.length, 2);
        assertEq(contributors[0], alice);
        assertEq(contributors[1], bob);
    }

    function test_CannotDonateZeroAmount() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Medical aid", "Healthcare", goal, deadline);

        vm.prank(alice);
        vm.expectRevert("Donation must be greater than 0");
        crowdfunding.donate{value: 0}(1);
    }

    function test_CannotDonateAfterDeadline() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 1 days;
        crowdfunding.createCampaign("Expired campaign", "Expired", goal, deadline);

        // Move time forward past the deadline
        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert("Campaign deadline passed");
        crowdfunding.donate{value: 0.1 ether}(1);
    }

    function test_CannotDonateToNonexistentCampaign() public {
        vm.prank(alice);
        vm.expectRevert("Campaign does not exist");
        crowdfunding.donate{value: 0.1 ether}(999);
    }

    // ============ Withdrawal Tests ============

    function test_WithdrawWhenGoalReached() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Save lakes", "Environmental", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 1.2 ether}(1);

        // Owner can now withdraw
        uint256 ownerBalanceBefore = owner.balance;
        crowdfunding.withdraw(1);
        uint256 ownerBalanceAfter = owner.balance;

        assertEq(ownerBalanceAfter - ownerBalanceBefore, 1.2 ether);

        (address campaignOwner, , , , , , bool withdrawn, ) = crowdfunding.getCampaign(1);
        assertEq(withdrawn, true);
    }

    function test_OnlyOwnerCanWithdraw() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Charity fund", "Charity", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 1.5 ether}(1);

        vm.prank(bob);
        vm.expectRevert("Only campaign owner can withdraw");
        crowdfunding.withdraw(1);
    }

    function test_CannotWithdrawWhenGoalNotReached() public {
        uint256 goal = 5 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Ambitious project", "Big goal", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 1 ether}(1);

        vm.expectRevert("Funding goal not reached");
        crowdfunding.withdraw(1);
    }

    function test_CannotWithdrawTwice() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("One-time project", "Single withdraw", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 1.5 ether}(1);

        crowdfunding.withdraw(1);

        vm.expectRevert("Funds have already been withdrawn");
        crowdfunding.withdraw(1);
    }

    // ============ Refund Tests ============

    function test_RefundWhenGoalNotReached() public {
        uint256 goal = 5 ether;
        uint256 deadline = block.timestamp + 1 days;
        crowdfunding.createCampaign("Small contribution", "Unmet goal", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 0.5 ether}(1);

        // Move time forward past deadline
        vm.warp(block.timestamp + 2 days);

        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        crowdfunding.refund(1);
        uint256 aliceBalanceAfter = alice.balance;

        assertEq(aliceBalanceAfter - aliceBalanceBefore, 0.5 ether);

        uint256 afterRefundContribution = crowdfunding.getContribution(1, alice);
        assertEq(afterRefundContribution, 0);
    }

    function test_CannotRefundBeforeDeadline() public {
        uint256 goal = 5 ether;
        uint256 deadline = block.timestamp + 7 days;
        crowdfunding.createCampaign("Active campaign", "Still running", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 0.5 ether}(1);

        vm.prank(alice);
        vm.expectRevert("Campaign still active");
        crowdfunding.refund(1);
    }

    function test_CannotRefundWhenGoalReached() public {
        uint256 goal = 1 ether;
        uint256 deadline = block.timestamp + 1 days;
        crowdfunding.createCampaign("Successful campaign", "Success", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 1.5 ether}(1);

        // Move time forward past deadline
        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert("Campaign succeeded, refunds disabled");
        crowdfunding.refund(1);
    }

    function test_CannotRefundWithoutDonation() public {
        uint256 goal = 5 ether;
        uint256 deadline = block.timestamp + 1 days;
        crowdfunding.createCampaign("No donors", "Test", goal, deadline);

        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert("No donation to refund");
        crowdfunding.refund(1);
    }

    function test_MultipleDonorsCanRefund() public {
        uint256 goal = 5 ether;
        uint256 deadline = block.timestamp + 1 days;
        crowdfunding.createCampaign("Partial funding", "Incomplete", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 0.5 ether}(1);

        vm.prank(bob);
        crowdfunding.donate{value: 0.3 ether}(1);

        vm.warp(block.timestamp + 2 days);

        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(alice);
        crowdfunding.refund(1);
        uint256 aliceBalanceAfter = alice.balance;
        assertEq(aliceBalanceAfter - aliceBalanceBefore, 0.5 ether);

        uint256 bobBalanceBefore = bob.balance;
        vm.prank(bob);
        crowdfunding.refund(1);
        uint256 bobBalanceAfter = bob.balance;
        assertEq(bobBalanceAfter - bobBalanceBefore, 0.3 ether);
    }

    // ============ Edge Cases & Reentrancy ============

    function test_ReentrancyProtectionOnRefund() public {
        uint256 goal = 5 ether;
        uint256 deadline = block.timestamp + 1 days;
        crowdfunding.createCampaign("Reentrancy test", "Security", goal, deadline);

        vm.prank(alice);
        crowdfunding.donate{value: 1 ether}(1);

        vm.warp(block.timestamp + 2 days);

        // Reentrancy guard should prevent multiple calls in same transaction
        vm.prank(alice);
        crowdfunding.refund(1);

        // Verify contribution was reset
        uint256 contribution = crowdfunding.getContribution(1, alice);
        assertEq(contribution, 0);
    }

    function test_CampaignCountIncrement() public {
        crowdfunding.createCampaign("Campaign 1", "First", 1 ether, block.timestamp + 7 days);
        crowdfunding.createCampaign("Campaign 2", "Second", 2 ether, block.timestamp + 7 days);
        crowdfunding.createCampaign("Campaign 3", "Third", 3 ether, block.timestamp + 7 days);

        uint256 count = crowdfunding.campaignCount();
        assertEq(count, 3);
    }
}
