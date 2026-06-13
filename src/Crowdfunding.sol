// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Crowdfunding {
    struct Campaign {
        address owner;
        string title;
        string description;
        uint256 goal;
        uint256 deadline;
        uint256 raised;
        bool withdrawn;
        address[] contributors;
    }

    mapping(uint256 => Campaign) private campaigns;
    mapping(uint256 => mapping(address => uint256)) private contributions;
    uint256 public campaignCount;
    bool private locked;

    event CampaignCreated(uint256 indexed campaignId, address indexed owner, uint256 goal, uint256 deadline);
    event DonationReceived(uint256 indexed campaignId, address indexed donor, uint256 amount);
    event FundsWithdrawn(uint256 indexed campaignId, address indexed owner, uint256 amount);
    event RefundIssued(uint256 indexed campaignId, address indexed contributor, uint256 amount);

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier campaignExists(uint256 campaignId) {
        require(campaignId > 0 && campaignId <= campaignCount, "Campaign does not exist");
        _;
    }

    function createCampaign(string calldata title, string calldata description, uint256 goal, uint256 deadline)
        external
    {
        require(goal > 0, "Goal must be greater than 0");
        require(deadline > block.timestamp, "Deadline must be in the future");

        campaignCount += 1;
        Campaign storage campaign = campaigns[campaignCount];
        campaign.owner = msg.sender;
        campaign.title = title;
        campaign.description = description;
        campaign.goal = goal;
        campaign.deadline = deadline;
        campaign.raised = 0;
        campaign.withdrawn = false;

        emit CampaignCreated(campaignCount, msg.sender, goal, deadline);
    }

    function donate(uint256 campaignId) external payable campaignExists(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        require(block.timestamp <= campaign.deadline, "Campaign deadline passed");
        require(!campaign.withdrawn, "Campaign already withdrawn");
        require(msg.value > 0, "Donation must be greater than 0");

        if (contributions[campaignId][msg.sender] == 0) {
            campaign.contributors.push(msg.sender);
        }
        contributions[campaignId][msg.sender] += msg.value;
        campaign.raised += msg.value;

        emit DonationReceived(campaignId, msg.sender, msg.value);
    }

    function withdraw(uint256 campaignId) external nonReentrant campaignExists(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        require(msg.sender == campaign.owner, "Only campaign owner can withdraw");
        require(campaign.raised >= campaign.goal, "Funding goal not reached");
        require(!campaign.withdrawn, "Funds have already been withdrawn");

        campaign.withdrawn = true;
        uint256 amount = campaign.raised;
        (bool sent,) = payable(campaign.owner).call{value: amount}("");
        require(sent, "Withdrawal failed");

        emit FundsWithdrawn(campaignId, campaign.owner, amount);
    }

    function refund(uint256 campaignId) external nonReentrant campaignExists(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        require(block.timestamp > campaign.deadline, "Campaign still active");
        require(campaign.raised < campaign.goal, "Campaign succeeded, refunds disabled");

        uint256 donated = contributions[campaignId][msg.sender];
        require(donated > 0, "No donation to refund");

        contributions[campaignId][msg.sender] = 0;
        (bool sent,) = payable(msg.sender).call{value: donated}("");
        require(sent, "Refund failed");

        emit RefundIssued(campaignId, msg.sender, donated);
    }

    function getCampaign(uint256 campaignId)
        external
        view
        campaignExists(campaignId)
        returns (
            address owner,
            string memory title,
            string memory description,
            uint256 goal,
            uint256 deadline,
            uint256 raised,
            bool withdrawn,
            address[] memory contributors
        )
    {
        Campaign storage campaign = campaigns[campaignId];
        return (
            campaign.owner,
            campaign.title,
            campaign.description,
            campaign.goal,
            campaign.deadline,
            campaign.raised,
            campaign.withdrawn,
            campaign.contributors
        );
    }

    function getContribution(uint256 campaignId, address contributor)
        external
        view
        campaignExists(campaignId)
        returns (uint256)
    {
        return contributions[campaignId][contributor];
    }
}
