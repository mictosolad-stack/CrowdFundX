const walletButton = document.getElementById("walletButton");
const walletAddress = document.getElementById("walletAddress");
const message = document.getElementById("message");
const campaignsContainer = document.getElementById("campaigns");
const campaignForm = document.getElementById("campaignForm");

let provider;
let signer;
let contract;
let userAddress;
let contractAddress;
let contractAbi;

async function loadContractFiles() {
  try {
    const [addressResponse, artifactResponse] = await Promise.all([
      fetch("./contract-address.json"),
      fetch("./Crowdfunding.json")
    ]);

    if (!addressResponse.ok || !artifactResponse.ok) {
      throw new Error("Contract metadata not found. Deploy the contract first.");
    }

    const addressData = await addressResponse.json();
    const artifact = await artifactResponse.json();
    contractAddress = addressData.Crowdfunding;
    contractAbi = artifact.abi;
  } catch (error) {
    showMessage(error.message, true);
  }
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#f97316" : "#22c55e";
}

async function initialize() {
  await loadContractFiles();

  if (!window.ethereum) {
    showMessage("Install MetaMask to use the DApp.", true);
    walletButton.disabled = true;
    return;
  }

  walletButton.addEventListener("click", connectWallet);
  campaignForm.addEventListener("submit", handleCampaignCreate);

  if (window.ethereum.selectedAddress) {
    await connectWallet();
  }
}

async function connectWallet() {
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    contract = new ethers.Contract(contractAddress, contractAbi, signer);
    walletAddress.textContent = `Connected: ${userAddress}`;
    walletButton.textContent = "Wallet connected";
    walletButton.disabled = true;
    showMessage("Wallet connected. You can create or donate to campaigns.");
    await loadCampaigns();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function handleCampaignCreate(event) {
  event.preventDefault();
  try {
    const title = document.getElementById("campaignTitle").value.trim();
    const description = document.getElementById("campaignDescription").value.trim();
    const goal = document.getElementById("campaignGoal").value;
    const deadlineValue = document.getElementById("campaignDeadline").value;

    if (!title || !description || !goal || !deadlineValue) {
      throw new Error("All campaign fields are required.");
    }

    const deadline = Math.floor(new Date(deadlineValue).getTime() / 1000);
    if (deadline <= Math.floor(Date.now() / 1000)) {
      throw new Error("Deadline must be set in the future.");
    }

    const tx = await contract.createCampaign(
      title,
      description,
      ethers.parseEther(goal.toString()),
      deadline
    );
    await tx.wait();
    showMessage("Campaign created successfully.");
    campaignForm.reset();
    await loadCampaigns();
  } catch (error) {
    showMessage(error.message || "Failed to create campaign.", true);
  }
}

async function loadCampaigns() {
  campaignsContainer.innerHTML = "";
  try {
    const count = await contract.campaignCount();
    const campaignCount = Number(count);
    if (campaignCount === 0) {
      campaignsContainer.innerHTML = "<p>No campaigns available yet.</p>";
      return;
    }

    for (let i = 1; i <= campaignCount; i += 1) {
      const campaign = await contract.getCampaign(i);
      const contribution = await contract.getContribution(i, userAddress || ethers.ZeroAddress);
      const owner = campaign.owner;
      const title = campaign.title;
      const description = campaign.description;
      const goal = ethers.formatEther(campaign.goal);
      const raised = ethers.formatEther(campaign.raised);
      const deadline = Number(campaign.deadline) * 1000;
      const withdrawn = campaign.withdrawn;
      const deadlineDate = new Date(deadline).toLocaleString();
      const progress = Math.min((Number(campaign.raised) / Number(campaign.goal)) * 100, 100).toFixed(2);
      const active = Date.now() <= deadline;

      const card = document.createElement("div");
      card.className = "campaign-card";
      card.innerHTML = `
        <h3>${title}</h3>
        <p>${description}</p>
        <div class="campaign-meta">
          <span>Owner: ${owner}</span>
          <span>Goal: ${goal} ETH</span>
          <span>Raised: ${raised} ETH</span>
          <span>Deadline: ${deadlineDate}</span>
          <span>Status: ${withdrawn ? "Withdrawn" : active ? "Active" : "Closed"}</span>
        </div>
        <div class="progress-area">
          <span>${progress}% funded</span>
          <div class="progress-bar"><div class="progress-completed" style="width:${progress}%"></div></div>
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "action-buttons";

      const donateButton = document.createElement("button");
      donateButton.textContent = "Donate";
      donateButton.onclick = () => donateToCampaign(i);
      actions.appendChild(donateButton);

      if (!withdrawn && owner.toLowerCase() === (userAddress || "").toLowerCase() && Number(campaign.raised) >= Number(campaign.goal)) {
        const withdrawButton = document.createElement("button");
        withdrawButton.textContent = "Withdraw funds";
        withdrawButton.onclick = () => withdrawFromCampaign(i);
        actions.appendChild(withdrawButton);
      }

      if (!active && Number(campaign.raised) < Number(campaign.goal) && Number(contribution) > 0) {
        const refundButton = document.createElement("button");
        refundButton.textContent = "Claim refund";
        refundButton.onclick = () => refundFromCampaign(i);
        actions.appendChild(refundButton);
      }

      card.appendChild(actions);
      campaignsContainer.appendChild(card);
    }
  } catch (error) {
    showMessage(error.message || "Unable to load campaigns.", true);
  }
}

async function donateToCampaign(campaignId) {
  const amount = prompt("Enter donation amount in ETH:", "0.01");
  if (!amount || Number(amount) <= 0) {
    return;
  }
  try {
    const tx = await contract.donate(campaignId, { value: ethers.parseEther(amount.toString()) });
    await tx.wait();
    showMessage("Donation successful.");
    await loadCampaigns();
  } catch (error) {
    showMessage(error.message || "Donation failed.", true);
  }
}

async function withdrawFromCampaign(campaignId) {
  try {
    const tx = await contract.withdraw(campaignId);
    await tx.wait();
    showMessage("Funds withdrawn to campaign owner.");
    await loadCampaigns();
  } catch (error) {
    showMessage(error.message || "Withdrawal failed.", true);
  }
}

async function refundFromCampaign(campaignId) {
  try {
    const tx = await contract.refund(campaignId);
    await tx.wait();
    showMessage("Refund received.");
    await loadCampaigns();
  } catch (error) {
    showMessage(error.message || "Refund failed.", true);
  }
}

initialize();
