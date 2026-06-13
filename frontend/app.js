const walletButton = document.getElementById("walletButton");
const walletAddress = document.getElementById("walletAddress");
const networkBadge = document.getElementById("networkBadge");
const contractStatus = document.getElementById("contractStatus");
const message = document.getElementById("message");
const campaignForm = document.getElementById("campaignForm");
const refreshButton = document.getElementById("refreshButton");
const campaignSearch = document.getElementById("campaignSearch");
const campaignTemplate = document.getElementById("campaignTemplate");
const toast = document.getElementById("toast");
const toastTitle = document.getElementById("toastTitle");
const toastMessage = document.getElementById("toastMessage");

const views = Array.from(document.querySelectorAll("[data-view]"));
const navLinks = Array.from(document.querySelectorAll("[data-view-link]"));
const viewActions = Array.from(document.querySelectorAll("[data-view-action]"));

const containers = {
  explore: document.getElementById("campaigns"),
  owned: document.getElementById("ownedCampaigns"),
  donated: document.getElementById("donatedCampaigns"),
  activity: document.getElementById("activityFeed")
};

const statEls = {
  heroRaised: document.getElementById("heroRaised"),
  total: document.getElementById("totalCampaigns"),
  active: document.getElementById("activeCampaigns"),
  successful: document.getElementById("successfulCampaigns"),
  contribution: document.getElementById("yourContribution"),
  ownedCount: document.getElementById("ownedCount"),
  backedCount: document.getElementById("backedCount"),
  backedTotal: document.getElementById("backedTotal"),
  refundableCount: document.getElementById("refundableCount")
};

const ADDRESS_PLACEHOLDER = "0xREPLACE_WITH_DEPLOYED_CONTRACT_ADDRESS";
const DEFAULT_CONTRACT_ADDRESS = "0x6cB0f2432724E4e7dFb7211554CEC4a594b69765";
const TOKEN_SYMBOL = "USDC";
// Arc native USDC uses 18 decimals for msg.value/gas accounting.
// Use 6 only if this dApp is rewritten to transfer ERC-20 USDC via transferFrom.
const TOKEN_DECIMALS = 18;
const ARC_TESTNET_CHAIN_ID = 5042002n;
const CHAIN_NAMES = {
  "5042002": "Arc Testnet"
};
const WRONG_NETWORK_MESSAGE = "Switch your wallet network to Arc Testnet to use CrowdFundX.";

let provider;
let signer;
let contract;
let userAddress = "";
let contractAddress = "";
let contractAbi = [];
let readInProgress = false;
let toastTimer;
let campaignsCache = [];
let activeView = "home";

async function initialize() {
  setDefaultDeadline();
  bindEvents();
  setBusy(false);
  setView(routeFromHash());
  resetStats();
  renderDisconnectedStates();

  await loadContractMetadata();
  applyContractAddress(contractAddress || DEFAULT_CONTRACT_ADDRESS);

  if (!window.ethereum) {
    showMessage("Install MetaMask or another injected wallet to use CrowdFundX.", "error");
    walletButton.disabled = true;
    renderAllEmptyStates("Wallet required", "Install a browser wallet, then refresh this page.");
    return;
  }

  window.ethereum.on?.("accountsChanged", handleAccountsChanged);
  window.ethereum.on?.("chainChanged", () => window.location.reload());

  if (window.ethereum.selectedAddress) {
    await connectWallet();
  }
}

function bindEvents() {
  walletButton.addEventListener("click", connectWallet);
  campaignForm.addEventListener("submit", handleCampaignCreate);
  refreshButton.addEventListener("click", loadCampaigns);
  campaignSearch.addEventListener("input", renderAllCampaignViews);

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setView(link.dataset.viewLink);
    });
  });

  viewActions.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewAction));
  });

  window.addEventListener("hashchange", () => setView(routeFromHash(), false));
}

function routeFromHash() {
  const route = window.location.hash.replace("#", "");
  return views.some((view) => view.dataset.view === route) ? route : "home";
}

function setView(viewName, updateHash = true) {
  activeView = viewName;
  views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
  navLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.viewLink === viewName));

  if (updateHash && window.location.hash !== `#${viewName}`) {
    window.location.hash = viewName;
  }

  renderAllCampaignViews();
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

    if (!(await isOnRequiredNetwork())) {
      campaignsCache = [];
      resetStats();
      renderAllEmptyStates("Wrong network", WRONG_NETWORK_MESSAGE);
      showMessage(WRONG_NETWORK_MESSAGE, "error");
      return;
    }

    if (!contractAddress) {
      showMessage("Contract address is not configured.", "warning");
      renderAllEmptyStates("Contract address needed", "Add a deployed contract address to the app config.");
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
  networkBadge.className = network.chainId === ARC_TESTNET_CHAIN_ID
    ? "status-badge ready"
    : "status-badge warning";
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
    campaignsCache = [];
    updateWalletUi();
    resetStats();
    renderDisconnectedStates();
    return;
  }

  await connectWallet();
}

async function handleCampaignCreate(event) {
  event.preventDefault();

  try {
    ensureReady();
    await ensureRequiredNetwork();
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
    setView("owned");
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
    await ensureRequiredNetwork();
    readInProgress = true;
    refreshButton.disabled = true;
    renderAllLoadingStates();

    const count = Number(await contract.campaignCount());
    const campaigns = [];
    for (let id = 1; id <= count; id += 1) {
      const campaign = await contract.getCampaign(id);
      const contribution = userAddress
        ? await contract.getContribution(id, userAddress)
        : 0n;
      campaigns.push(normalizeCampaign(id, campaign, contribution));
    }

    campaignsCache = campaigns;
    updateStats(campaignsCache);
    renderAllCampaignViews();
    showMessage(`Loaded ${count} campaign${count === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    const text = readableError(error, "Unable to load campaigns.");
    renderAllEmptyStates("Could not load campaigns", text);
    showMessage(text, "error");
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

function renderAllCampaignViews() {
  renderCampaignList(containers.explore, filteredExploreCampaigns(), {
    emptyTitle: "No campaigns found",
    emptyDescription: searchTerm()
      ? "Try another title, owner address, description, or campaign ID."
      : "Create the first campaign from the creator page."
  });

  renderCampaignList(containers.owned, ownedCampaigns(), {
    emptyTitle: "No owned campaigns",
    emptyDescription: userAddress
      ? "Campaigns created by your connected wallet will appear here."
      : "Connect your wallet to see campaigns you own."
  });

  renderCampaignList(containers.donated, donatedCampaigns(), {
    emptyTitle: "No donations yet",
    emptyDescription: userAddress
      ? "Campaigns you support with USDC will appear here."
      : "Connect your wallet to see campaigns you donated to."
  });

  renderActivity();
}

function filteredExploreCampaigns() {
  const term = searchTerm();
  const campaigns = campaignsCache.slice().sort((a, b) => b.id - a.id);
  if (!term) return campaigns;
  return campaigns.filter((campaign) => [
    String(campaign.id),
    campaign.title,
    campaign.description,
    campaign.owner
  ].some((value) => value.toLowerCase().includes(term)));
}

function ownedCampaigns() {
  if (!userAddress) return [];
  return campaignsCache
    .filter((campaign) => campaign.owner.toLowerCase() === userAddress.toLowerCase())
    .sort((a, b) => b.id - a.id);
}

function donatedCampaigns() {
  if (!userAddress) return [];
  return campaignsCache
    .filter((campaign) => campaign.contribution > 0n)
    .sort((a, b) => b.id - a.id);
}

function searchTerm() {
  return campaignSearch.value.trim().toLowerCase();
}

function renderCampaignList(container, campaigns, emptyState) {
  container.innerHTML = "";
  if (!campaigns.length) {
    renderEmptyState(container, emptyState.emptyTitle, emptyState.emptyDescription);
    return;
  }

  campaigns.forEach((campaign) => container.appendChild(createCampaignCard(campaign)));
}

function createCampaignCard(campaign) {
  const card = campaignTemplate.content.firstElementChild.cloneNode(true);
  const state = campaignState(campaign);
  const isOwner = Boolean(userAddress) && campaign.owner.toLowerCase() === userAddress.toLowerCase();
  const canDonate = Boolean(userAddress) && campaign.active && !campaign.withdrawn;
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
    await ensureRequiredNetwork();
    setBusy(true, "Sending donation...");
    const tx = await contract.donate(campaignId, { value: parseTokenAmount(amount) });
    showMessage("Donation submitted. Waiting for confirmation...", "success");
    await tx.wait();
    showMessage("Donation confirmed.", "success");
    await loadCampaigns();
    setView("donated");
  } catch (error) {
    showMessage(readableError(error, "Donation failed."), "error");
  } finally {
    setBusy(false);
  }
}

async function withdrawFromCampaign(campaignId) {
  try {
    ensureReady();
    await ensureRequiredNetwork();
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
    await ensureRequiredNetwork();
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

function renderActivity() {
  const owned = ownedCampaigns();
  const backed = donatedCampaigns();
  const backedTotal = backed.reduce((sum, campaign) => sum + campaign.contribution, 0n);
  const refundable = backed.filter((campaign) => !campaign.active && !campaign.successful).length;

  statEls.ownedCount.textContent = String(owned.length);
  statEls.backedCount.textContent = String(backed.length);
  statEls.backedTotal.textContent = formatTokenAmount(backedTotal);
  statEls.refundableCount.textContent = String(refundable);

  containers.activity.innerHTML = "";
  if (!userAddress) {
    renderEmptyState(containers.activity, "Connect wallet", "Connect your wallet to track your CrowdFundX activity.");
    return;
  }

  const entries = [
    ...owned.map((campaign) => ({
      title: `Created campaign #${campaign.id}`,
      meta: campaign.title,
      amount: formatTokenAmount(campaign.raised),
      state: campaignState(campaign).label
    })),
    ...backed.map((campaign) => ({
      title: `Backed campaign #${campaign.id}`,
      meta: campaign.title,
      amount: formatTokenAmount(campaign.contribution),
      state: campaign.active ? "Active" : campaign.successful ? "Succeeded" : "Refundable"
    }))
  ].sort((a, b) => Number(b.title.match(/\d+/)?.[0] || 0) - Number(a.title.match(/\d+/)?.[0] || 0));

  if (!entries.length) {
    renderEmptyState(containers.activity, "No activity yet", "Create or back a campaign and your activity will appear here.");
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "activity-item";

    const content = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = entry.title;
    const meta = document.createElement("p");
    meta.textContent = entry.meta;
    content.append(title, meta);

    const detail = document.createElement("div");
    detail.className = "activity-detail";
    const amount = document.createElement("strong");
    amount.textContent = entry.amount;
    const state = document.createElement("span");
    state.textContent = entry.state;
    detail.append(amount, state);

    item.append(content, detail);
    containers.activity.appendChild(item);
  });
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
  renderActivity();
}

function resetStats() {
  statEls.heroRaised.textContent = `0 ${TOKEN_SYMBOL}`;
  statEls.total.textContent = "0";
  statEls.active.textContent = "0";
  statEls.successful.textContent = "0";
  statEls.contribution.textContent = `0 ${TOKEN_SYMBOL}`;
  statEls.ownedCount.textContent = "0";
  statEls.backedCount.textContent = "0";
  statEls.backedTotal.textContent = `0 ${TOKEN_SYMBOL}`;
  statEls.refundableCount.textContent = "0";
}

function renderAllLoadingStates() {
  Object.values(containers).forEach((container) => {
    if (container === containers.activity) return;
    const panel = document.createElement("div");
    panel.className = "empty-state";
    panel.textContent = "Loading campaigns...";
    container.replaceChildren(panel);
  });
}

function renderDisconnectedStates() {
  renderAllEmptyStates("Connect wallet", "Connect your wallet on Arc testnet to load on-chain campaign data.");
}

function renderAllEmptyStates(title, description) {
  renderEmptyState(containers.explore, title, description);
  renderEmptyState(containers.owned, title, description);
  renderEmptyState(containers.donated, title, description);
  renderEmptyState(containers.activity, title, description);
}

function renderEmptyState(container, title, description) {
  const panel = document.createElement("div");
  panel.className = "empty-state";

  const heading = document.createElement("h2");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;

  panel.append(heading, copy);
  container.replaceChildren(panel);
}

function ensureReady() {
  if (!window.ethereum) throw new Error("Wallet extension not found.");
  if (!signer || !userAddress) throw new Error("Connect your wallet first.");
  if (!contractAddress) throw new Error("Contract address is not configured.");
  if (!contract) throw new Error("Contract is not ready yet.");
}

async function ensureRequiredNetwork() {
  if (!provider) throw new Error("Connect your wallet first.");
  if (!(await isOnRequiredNetwork())) throw new Error(WRONG_NETWORK_MESSAGE);
}

async function isOnRequiredNetwork() {
  if (!provider) return false;
  const network = await provider.getNetwork();
  return network.chainId === ARC_TESTNET_CHAIN_ID;
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
  if (tone === "error" || tone === "warning") {
    showToast(tone === "error" ? "Action needed" : "Heads up", text, tone);
  }
}

function showToast(title, text, tone = "error") {
  clearTimeout(toastTimer);
  toastTitle.textContent = title;
  toastMessage.textContent = text;
  toast.className = `toast is-visible ${tone}`;
  toast.setAttribute("aria-hidden", "false");
  toastTimer = setTimeout(() => {
    toast.className = "toast";
    toast.setAttribute("aria-hidden", "true");
  }, 5200);
}

function readableError(error, fallback) {
  const raw = error?.shortMessage || error?.reason || error?.message || fallback;
  if (/could not decode result data|BAD_DATA|missing revert data/i.test(raw)) {
    return WRONG_NETWORK_MESSAGE;
  }
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
