const walletButton = document.getElementById("walletButton");
const walletAddress = document.getElementById("walletAddress");
const networkBadge = document.getElementById("networkBadge");
const contractStatus = document.getElementById("contractStatus");
const message = document.getElementById("message");
const campaignsContainer = document.getElementById("campaigns");
const campaignForm = document.getElementById("campaignForm");
const refreshButton = document.getElementById("refreshButton");
const campaignTemplate = document.getElementById("campaignTemplate");

const statEls = {
  heroRaised: document.getElementById("heroRaised"),
  total: document.getElementById("totalCampaigns"),
  active: document.getElementById("activeCampaigns"),
  successful: document.getElementById("successfulCampaigns"),
  contribution: document.getElementById("yourContribution")
};

const ADDRESS_PLACEHOLDER = "0xREPLACE_WITH_DEPLOYED_CONTRACT_ADDRESS";
const DEFAULT_CONTRACT_ADDRESS = "0x6cB0f2432724E4e7dFb7211554CEC4a594b69765";
const TOKEN_SYMBOL = "USDC";
// Arc native USDC uses 18 decimals for msg.value/gas accounting.
// Use 6 only if this dApp is rewritten to transfer ERC-20 USDC via transferFrom.
const TOKEN_DECIMALS = 18;
const CHAIN_NAMES = {
  "5042002": "Arc Testnet"
};

let provider;
let signer;
let contract;
let userAddress = "";
let contractAddress = "";
let contractAbi = [];
let readInProgress = false;

async function initialize() {
  setDefaultDeadline();
  bindEvents();
  setBusy(false);

  await loadContractMetadata();
  applyContractAddress(contractAddress || DEFAULT_CONTRACT_ADDRESS);

  if (!window.ethereum) {
    showMessage("Install MetaMask or another injected wallet to use CrowdFundX.", "error");
    walletButton.disabled = true;
    renderEmptyState("Wallet required", "Install a browser wallet, then refresh this page.");
    return;
  }

  window.ethereum.on?.("accountsChanged", handleAccountsChanged);
  window.ethereum.on?.("chainChanged", () => window.location.reload());

  if (window.ethereum.selectedAddress) {
    await connectWallet();
  } else {
    renderEmptyState("Connect wallet", "Connect your wallet on Arc testnet to create campaigns and load on-chain data.");
  }
}

function bindEvents() {
  walletButton.addEventListener("click", connectWallet);
  campaignForm.addEventListener("submit", handleCampaignCreate);
  refreshButton.addEventListener("click", loadCampaigns);
}

async function loadContractMetadata() {
  try {
    const [addressResponse, artifactResponse] = await Promise.all([
      fetch("./contract-address.json", { cache: "no-store" }),
      fetch("./Crowdfunding.json", { cache: "no-store" })
    ]);

    if (artifactResponse.ok) {
      const artifact = await artifactResponse.json();
      contractAbi = artifact.abi || [];
    }

    if (addressResponse.ok) {
      const addressData = await addressResponse.json();
      contractAddress = addressData.Crowdfunding || "";
    }
  } catch (error) {
    showMessage("Could not load local contract metadata. Using the bundled Arc contract config.", "warning");
  }
}

function applyContractAddress(address) {
  contractAddress = isConfiguredAddress(address) ? address.trim() : "";

  if (contractAddress) {
    contractStatus.textContent = "Arc contract ready";
    contractStatus.className = "ready";
  } else {
    contractStatus.textContent = "Contract not configured";
    contractStatus.className = "";
  }

  if (signer && contractAddress && contractAbi.length) {
    contract = new ethers.Contract(contractAddress, contractAbi, signer);
  }
}

async function connectWallet() {
  try {
    if (!contractAbi.length) {
      throw new Error("Contract ABI is missing. Add frontend/Crowdfunding.json.");
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    await updateNetworkBadge();
    applyContractAddress(contractAddress);
    updateWalletUi();

    if (!contractAddress) {
      showMessage("Contract address is not configured.", "warning");
      renderEmptyState("Contract address needed", "Add a deployed contract address to the app config.");
      return;
    }

    showMessage("Wallet connected. Loading campaigns...", "success");
    await loadCampaigns();
  } catch (error) {
    showMessage(readableError(error, "Wallet connection failed."), "error");
  }
}

async function updateNetworkBadge() {
  if (!provider) return;
  const network = await provider.getNetwork();
  const chainName = CHAIN_NAMES[network.chainId.toString()]
    || (network.name === "unknown" ? `Chain ${network.chainId}` : network.name);
  networkBadge.textContent = chainName;
  networkBadge.className = "status-badge ready";
}

function updateWalletUi() {
  if (!userAddress) {
    walletAddress.textContent = "Wallet not connected";
    walletButton.disabled = false;
    walletButton.querySelector("span:last-child").textContent = "Connect Wallet";
    return;
  }

  walletAddress.textContent = `Connected: ${shortAddress(userAddress)}`;
  walletButton.disabled = true;
  walletButton.querySelector("span:last-child").textContent = "Connected";
}

async function handleAccountsChanged(accounts) {
  userAddress = accounts?.[0] || "";
  if (!userAddress) {
    signer = undefined;
    contract = undefined;
    updateWalletUi();
    resetStats();
    renderEmptyState("Connect wallet", "Reconnect your wallet to continue using CrowdFundX.");
    return;
  }

  await connectWallet();
}

async function handleCampaignCreate(event) {
  event.preventDefault();

  try {
    ensureReady();
    const title = document.getElementById("campaignTitle").value.trim();
    const description = document.getElementById("campaignDescription").value.trim();
    const goal = document.getElementById("campaignGoal").value;
    const deadlineValue = document.getElementById("campaignDeadline").value;
    const deadline = Math.floor(new Date(deadlineValue).getTime() / 1000);

    if (!title || !description || !goal || !deadlineValue) {
      throw new Error("Fill in every campaign field.");
    }

    if (deadline <= nowSeconds()) {
      throw new Error("Choose a deadline in the future.");
    }

    setBusy(true, "Creating campaign...");
    const tx = await contract.createCampaign(title, description, parseTokenAmount(goal), deadline);
    showMessage("Transaction submitted. Waiting for confirmation...", "success");
    await tx.wait();

    campaignForm.reset();
    setDefaultDeadline();
    showMessage("Campaign created successfully.", "success");
    await loadCampaigns();
  } catch (error) {
    showMessage(readableError(error, "Failed to create campaign."), "error");
  } finally {
    setBusy(false);
  }
}

async function loadCampaigns() {
  if (readInProgress) return;

  try {
    ensureReady();
    readInProgress = true;
    refreshButton.disabled = true;
    campaignsContainer.innerHTML = "";
    renderLoadingState();

    const count = Number(await contract.campaignCount());
    if (count === 0) {
      resetStats();
      renderEmptyState("No campaigns yet", "Create the first campaign from the creator desk.");
      return;
    }

    const campaigns = [];
    for (let id = 1; id <= count; id += 1) {
      const campaign = await contract.getCampaign(id);
      const contribution = userAddress
        ? await contract.getContribution(id, userAddress)
        : 0n;
      campaigns.push(normalizeCampaign(id, campaign, contribution));
    }

    updateStats(campaigns);
    renderCampaigns(campaigns);
    showMessage(`Loaded ${count} campaign${count === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    renderEmptyState("Could not load campaigns", readableError(error, "Check your wallet network and contract address."));
    showMessage(readableError(error, "Unable to load campaigns."), "error");
  } finally {
    readInProgress = false;
    refreshButton.disabled = false;
  }
}

function normalizeCampaign(id, campaign, contribution) {
  const owner = campaign.owner;
  const title = campaign.title;
  const description = campaign.description;
  const goal = BigInt(campaign.goal);
  const raised = BigInt(campaign.raised);
  const deadline = Number(campaign.deadline);
  const withdrawn = campaign.withdrawn;
  const contributors = campaign.contributors || [];
  const active = nowSeconds() <= deadline;
  const successful = raised >= goal;
  const progress = goal === 0n ? 0 : Number((raised * 10000n) / goal) / 100;

  return {
    id,
    owner,
    title,
    description,
    goal,
    raised,
    deadline,
    withdrawn,
    contributors,
    contribution: BigInt(contribution),
    active,
    successful,
    progress: Math.min(progress, 100)
  };
}

function renderCampaigns(campaigns) {
  campaignsContainer.innerHTML = "";
  campaigns
    .slice()
    .sort((a, b) => b.id - a.id)
    .forEach((campaign) => campaignsContainer.appendChild(createCampaignCard(campaign)));
}

function createCampaignCard(campaign) {
  const card = campaignTemplate.content.firstElementChild.cloneNode(true);
  const state = campaignState(campaign);
  const isOwner = campaign.owner.toLowerCase() === userAddress.toLowerCase();
  const canDonate = campaign.active && !campaign.withdrawn;
  const canWithdraw = isOwner && campaign.successful && !campaign.withdrawn;
  const canRefund = !campaign.active && !campaign.successful && campaign.contribution > 0n;

  card.querySelector(".campaign-id").textContent = `Campaign #${campaign.id}`;
  card.querySelector("h3").textContent = campaign.title;
  card.querySelector(".campaign-description").textContent = campaign.description;
  card.querySelector(".campaign-state").textContent = state.label;
  card.querySelector(".campaign-state").className = `campaign-state ${state.className}`;
  card.querySelector(".campaign-goal").textContent = formatTokenAmount(campaign.goal);
  card.querySelector(".campaign-raised").textContent = formatTokenAmount(campaign.raised);
  card.querySelector(".campaign-backers").textContent = String(campaign.contributors.length);
  card.querySelector(".campaign-deadline").textContent = formatDate(campaign.deadline);
  card.querySelector(".campaign-percent").textContent = `${campaign.progress.toFixed(1)}% funded`;
  card.querySelector(".campaign-remaining").textContent = campaign.active
    ? timeRemaining(campaign.deadline)
    : "Deadline passed";
  card.querySelector(".progress-completed").style.width = `${campaign.progress}%`;
  card.querySelector(".owner-line").textContent = `Owner ${shortAddress(campaign.owner)} • You backed ${formatTokenAmount(campaign.contribution)}`;

  const donateForm = card.querySelector(".donate-form");
  donateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amountInput = donateForm.querySelector(".donate-amount");
    donateToCampaign(campaign.id, amountInput.value).then(() => {
      amountInput.value = "";
    });
  });

  const donateButton = donateForm.querySelector("button");
  donateButton.disabled = !canDonate;
  donateForm.querySelector(".donate-amount").disabled = !canDonate;

  const ownerActions = card.querySelector(".owner-actions");
  if (canWithdraw) {
    ownerActions.appendChild(actionButton("Withdraw funds", () => withdrawFromCampaign(campaign.id), "primary-button"));
  }
  if (canRefund) {
    ownerActions.appendChild(actionButton("Claim refund", () => refundFromCampaign(campaign.id), "secondary-button"));
  }
  if (!canWithdraw && !canRefund) {
    ownerActions.remove();
  }

  return card;
}

function actionButton(label, handler, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function donateToCampaign(campaignId, amount) {
  if (!amount || Number(amount) <= 0) {
    showMessage("Enter a donation amount greater than zero.", "error");
    return;
  }

  try {
    ensureReady();
    setBusy(true, "Sending donation...");
    const tx = await contract.donate(campaignId, { value: parseTokenAmount(amount) });
    showMessage("Donation submitted. Waiting for confirmation...", "success");
    await tx.wait();
    showMessage("Donation confirmed.", "success");
    await loadCampaigns();
  } catch (error) {
    showMessage(readableError(error, "Donation failed."), "error");
  } finally {
    setBusy(false);
  }
}

async function withdrawFromCampaign(campaignId) {
  try {
    ensureReady();
    setBusy(true, "Withdrawing funds...");
    const tx = await contract.withdraw(campaignId);
    await tx.wait();
    showMessage("Funds withdrawn to the campaign owner.", "success");
    await loadCampaigns();
  } catch (error) {
    showMessage(readableError(error, "Withdrawal failed."), "error");
  } finally {
    setBusy(false);
  }
}

async function refundFromCampaign(campaignId) {
  try {
    ensureReady();
    setBusy(true, "Claiming refund...");
    const tx = await contract.refund(campaignId);
    await tx.wait();
    showMessage("Refund received.", "success");
    await loadCampaigns();
  } catch (error) {
    showMessage(readableError(error, "Refund failed."), "error");
  } finally {
    setBusy(false);
  }
}

function campaignState(campaign) {
  if (campaign.withdrawn) return { label: "Withdrawn", className: "neutral" };
  if (campaign.successful) return { label: "Goal reached", className: "success" };
  if (campaign.active) return { label: "Active", className: "active" };
  return { label: "Refundable", className: "warning" };
}

function updateStats(campaigns) {
  const totalRaised = campaigns.reduce((sum, campaign) => sum + campaign.raised, 0n);
  const active = campaigns.filter((campaign) => campaign.active && !campaign.withdrawn).length;
  const successful = campaigns.filter((campaign) => campaign.successful).length;
  const contribution = campaigns.reduce((sum, campaign) => sum + campaign.contribution, 0n);

  statEls.heroRaised.textContent = formatTokenAmount(totalRaised);
  statEls.total.textContent = String(campaigns.length);
  statEls.active.textContent = String(active);
  statEls.successful.textContent = String(successful);
  statEls.contribution.textContent = formatTokenAmount(contribution);
}

function resetStats() {
  statEls.heroRaised.textContent = `0 ${TOKEN_SYMBOL}`;
  statEls.total.textContent = "0";
  statEls.active.textContent = "0";
  statEls.successful.textContent = "0";
  statEls.contribution.textContent = `0 ${TOKEN_SYMBOL}`;
}

function renderLoadingState() {
  const panel = document.createElement("div");
  panel.className = "empty-state";
  panel.textContent = "Loading campaigns...";
  campaignsContainer.replaceChildren(panel);
}

function renderEmptyState(title, description) {
  const panel = document.createElement("div");
  panel.className = "empty-state";

  const heading = document.createElement("h3");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;

  panel.append(heading, copy);
  campaignsContainer.replaceChildren(panel);
}

function ensureReady() {
  if (!window.ethereum) throw new Error("Wallet extension not found.");
  if (!signer || !userAddress) throw new Error("Connect your wallet first.");
  if (!contractAddress) throw new Error("Save a deployed contract address first.");
  if (!contract) throw new Error("Contract is not ready yet.");
}

function setBusy(isBusy, text = "") {
  walletButton.classList.toggle("is-busy", isBusy);
  campaignForm.querySelectorAll("button, input, textarea").forEach((el) => {
    el.disabled = isBusy;
  });
  if (text) showMessage(text, "success");
}

function showMessage(text, tone = "success") {
  message.textContent = text;
  message.className = tone;
}

function readableError(error, fallback) {
  const raw = error?.shortMessage || error?.reason || error?.message || fallback;
  return raw.replace(/^execution reverted: /i, "");
}

function isConfiguredAddress(address) {
  return Boolean(address && address !== ADDRESS_PLACEHOLDER && ethers.isAddress(address));
}

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseTokenAmount(amount) {
  return ethers.parseUnits(amount, TOKEN_DECIMALS);
}

function formatTokenAmount(value) {
  const formatted = ethers.formatUnits(value, TOKEN_DECIMALS);
  const [whole, decimals = ""] = formatted.split(".");
  const trimmed = decimals.slice(0, 4).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ${TOKEN_SYMBOL}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function timeRemaining(deadline) {
  const seconds = deadline - nowSeconds();
  if (seconds <= 0) return "Deadline passed";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function setDefaultDeadline() {
  const input = document.getElementById("campaignDeadline");
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setMinutes(tomorrow.getMinutes() - tomorrow.getTimezoneOffset());
  input.value = tomorrow.toISOString().slice(0, 16);
}

initialize();
