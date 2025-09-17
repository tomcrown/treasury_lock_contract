import { useState } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

// Constants for Move contract components
const PACKAGE_ID =
  "0x1c48c1769a145b5c0b79f2f7f7668a6c2bf1161df7bb0a7548ce968bd4c9a76a";
const MODULE_NAME = "lock";
const CLOCK_OBJECT_ID = "0x6";

// Initialize Sui client to interact with the blockchain
const client = new SuiClient({ url: getFullnodeUrl("testnet") });

export default function App() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  const [duration, setDuration] = useState(5);
  const [lockerId, setLockerId] = useState("");
  const [info, setInfo] = useState<any | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const amount = parseFloat(amountInput);
  const isLendDisabled = !currentAccount || !amount || amount <= 0;

  // ---- New state for custom coin ----
  const [coinType, setCoinType] = useState("");
  const [customAmountInput, setCustomAmountInput] = useState("");
  const [customDuration, setCustomDuration] = useState(5);
  const customAmount = parseFloat(customAmountInput);
  const isCustomLendDisabled =
    !currentAccount || !coinType || !customAmount || customAmount <= 0;

  // Sends a transaction to lock (lend) SUI tokens
  async function lend() {
    if (!currentAccount || !amount || duration <= 0) {
      alert("Amount or duration must be greater than zero.");
      return;
    }

    try {
      const tx = new Transaction();
      tx.setGasBudget(100000000);

      // Convert entered amount in SUI to `mist` (1e9)
      const suiAmount = BigInt(amount * 1_000_000_000);
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiAmount)]);

      // Call the Move `lend` function with the coin and duration
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::lend`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [coin, tx.pure.u64(duration), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({
        transaction: tx,
      })) as any;

      console.log("Lend result:", result);

      const digest = result?.digest || result?.effects?.transactionDigest;
      const txBlock = (await client.getTransactionBlock({
        digest,
        options: { showObjectChanges: true },
      })) as any;

      const createdObjects = txBlock.objectChanges?.filter(
        (c: any) => c.type === "created"
      );
      const lockerObj = createdObjects?.find((c: any) =>
        c.objectType.includes("Locker<0x2::sui::SUI>")
      );

      if (lockerObj) {
        setLockerId(lockerObj.objectId);
        alert(`Lock successful! Locker ID: ${lockerObj.objectId}`);
      } else {
        alert("Lock successful, but no Locker object was found.");
      }

      setAmountInput("");
      setDuration(5);
    } catch (error) {
      console.error("Lock failed:", error);
      alert("Lock failed.");
    }
  }

  // Sends a transaction to lock (lend) custom coin tokens
  async function lendCustomCoin() {
    if (!currentAccount || !customAmount || customDuration <= 0 || !coinType) {
      alert("Coin type, amount, and duration are required.");
      return;
    }

    try {
      const coins = await client.getCoins({
        owner: currentAccount.address,
        coinType,
      });

      if (!coins.data.length) {
        alert(`No coins of type ${coinType} found in your wallet.`);
        return;
      }

      const coinObj = coins.data.find(
        (c) => BigInt(c.balance) >= BigInt(customAmount * 1_000_000_000)
      );
      if (!coinObj) {
        alert(
          `No single coin object has enough balance for ${customAmount} units.`
        );
        return;
      }

      const tx = new Transaction();
      tx.setGasBudget(100000000);

      const [splitCoin] = tx.splitCoins(tx.object(coinObj.coinObjectId), [
        tx.pure.u64(BigInt(customAmount * 1_000_000_000)),
      ]);

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::lend`,
        typeArguments: [coinType],
        arguments: [
          splitCoin,
          tx.pure.u64(customDuration),
          tx.object(CLOCK_OBJECT_ID),
        ],
      });

      const result = (await signAndExecuteTransaction({
        transaction: tx,
      })) as any;
      console.log("Custom lend result:", result);

      const digest = result?.digest || result?.effects?.transactionDigest;
      const txBlock = (await client.getTransactionBlock({
        digest,
        options: { showObjectChanges: true },
      })) as any;

      const createdObjects = txBlock.objectChanges?.filter(
        (c: any) => c.type === "created"
      );
      const lockerObj = createdObjects?.find((c: any) =>
        c.objectType.includes(`Locker<${coinType}>`)
      );

      if (lockerObj) {
        setLockerId(lockerObj.objectId);
        alert(`Custom coin lend successful! Locker ID: ${lockerObj.objectId}`);
      } else {
        alert("Lend successful, but no Locker object was found.");
      }

      setCustomAmountInput("");
      setCustomDuration(5);
    } catch (error) {
      console.error("Custom lend failed:", error);
      alert("Custom lend failed.");
    }
  }

  // Withdraw a locked loan (SUI only)
  async function withdrawLoan() {
    if (!lockerId || !currentAccount) {
      alert("Locker ID or wallet not connected.");
      return;
    }

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::withdraw_loan`,
        typeArguments: ["0x2::sui::SUI"],
        arguments: [tx.object(lockerId), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({
        transaction: tx,
      })) as any;
      console.log("Withdraw result:", result);

      const status = result?.effects?.status?.status;
      const errorMessage = result?.effects?.status?.error;

      if (status === "failure") {
        console.error("Withdraw failed:", errorMessage);
        if (errorMessage?.toLowerCase().includes("code 2")) {
          alert(
            "Error: It's too early to withdraw. Please wait until the lock duration ends."
          );
        } else {
          alert(`Withdraw failed: ${errorMessage}`);
        }
        return;
      }

      alert("Withdraw successful!");
      setLockerId("");
    } catch (error: any) {
      console.error("Withdraw failed:", error);
      const serialized = error?.toString() || "";
      if (serialized.includes("code 2")) {
        alert(
          "Error: It's too early to withdraw. Please wait until the lock duration ends."
        );
      } else {
        alert("Withdraw failed.");
      }
    }
  }

  // Withdraw a locked loan (Custom type)
  async function withdrawCustomLoan() {
    if (!lockerId || !currentAccount) {
      alert("Locker ID or wallet not connected.");
      return;
    }

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::withdraw_loan`,
        typeArguments: [coinType],
        arguments: [tx.object(lockerId), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = (await signAndExecuteTransaction({
        transaction: tx,
      })) as any;
      console.log("Withdraw result:", result);

      const status = result?.effects?.status?.status;
      const errorMessage = result?.effects?.status?.error;

      if (status === "failure") {
        console.error("Withdraw failed:", errorMessage);
        if (errorMessage?.toLowerCase().includes("code 2")) {
          alert(
            "Error: It's too early to withdraw. Please wait until the lock duration ends."
          );
        } else {
          alert(`Withdraw failed: ${errorMessage}`);
        }
        return;
      }

      alert("Withdraw successful!");
      setLockerId("");
    } catch (error: any) {
      console.error("Withdraw failed:", error);
      const serialized = error?.toString() || "";
      if (serialized.includes("code 2")) {
        alert(
          "Error: It's too early to withdraw. Please wait until the lock duration ends."
        );
      } else {
        alert("Withdraw failed.");
      }
    }
  }

  // Fetch locker info
  async function getLockerInfo() {
    if (!lockerId) return;

    try {
      const res = await client.getObject({
        id: lockerId,
        options: { showContent: true },
      });

      if (res.data?.content?.dataType === "moveObject") {
        const fields = (res.data.content as any).fields;
        setInfo([
          fields.lender,
          fields.balance,
          fields.start_time,
          fields.duration,
        ]);
      } else {
        console.error("Unexpected object format:", res);
        alert("Unexpected locker format.");
      }
    } catch (e) {
      console.error("Failed to fetch locker info:", e);
      alert("Failed to fetch locker info.");
    }
  }

  return (
    <div className="min-h-screen bg-blue-1000 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 pt-8">
          <h1 className="text-4xl font-bold text-white bg-clip-text text-transparent mb-4">
            Treasury Lock
          </h1>
        </div>

        {/* Connect Wallet Card */}
        <div className="bg-slate-800/50 backdrop-blur-lg rounded-2xl p-6 mb-8 border border-slate-700/50 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white mb-2">
                Wallet Connection
              </h3>
              {currentAccount ? (
                <p className="text-green-400 text-sm">✅ Wallet connected</p>
              ) : (
                <p className="text-amber-400 text-sm">
                  ⚠️ Connect your wallet to continue
                </p>
              )}
            </div>
            <div className="scale-90">
              <ConnectButton />
            </div>
          </div>
        </div>

        {/* Main Content - Always Visible */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* SUI Lending Section */}
          <div className="bg-slate-800/50 backdrop-blur-lg rounded-2xl p-6 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center mb-6">
              <h2 className="text-2xl font-bold text-white">Lock SUI</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Amount (SUI)
                </label>
                <input
                  type="text"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="e.g. 1.5"
                  disabled={!currentAccount}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Duration (minutes)
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  disabled={!currentAccount}
                />
              </div>

              <button
                onClick={lend}
                disabled={isLendDisabled}
                className={`w-full py-3 px-6 rounded-xl font-semibold transition-all duration-200 ${
                  isLendDisabled
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:from-blue-700 hover:to-cyan-700 transform hover:scale-[1.02] shadow-lg"
                }`}
              >
                {!currentAccount
                  ? "Connect Wallet to Lock SUI"
                  : "Lock SUI Tokens"}
              </button>
            </div>
          </div>

          {/* Custom Coin Lending Section */}
          <div className="bg-slate-800/50 backdrop-blur-lg rounded-2xl p-6 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                Lock Custom Coin
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Coin Type
                </label>
                <input
                  type="text"
                  value={coinType}
                  onChange={(e) => setCoinType(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  placeholder="0xYourPackage::yourcoin::YOURCOIN"
                  disabled={!currentAccount}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Amount
                </label>
                <input
                  type="text"
                  value={customAmountInput}
                  onChange={(e) => setCustomAmountInput(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  placeholder="e.g. 50"
                  disabled={!currentAccount}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Duration (minutes)
                </label>
                <input
                  type="number"
                  value={customDuration}
                  onChange={(e) => setCustomDuration(parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  disabled={!currentAccount}
                />
              </div>

              <button
                onClick={lendCustomCoin}
                disabled={isCustomLendDisabled}
                className={`w-full py-3 px-6 rounded-xl font-semibold transition-all duration-200 ${
                  isCustomLendDisabled
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:from-amber-700 hover:to-orange-700 transform hover:scale-[1.02] shadow-lg"
                }`}
              >
                {!currentAccount
                  ? "Connect Wallet to Lock Custom"
                  : "Lock Custom Tokens"}
              </button>
            </div>
          </div>
        </div>

        {/* Locker Management Section - Always Visible */}
        <div className="mt-8 bg-slate-800/50 backdrop-blur-lg rounded-2xl p-6 border border-slate-700/50 shadow-2xl">
          <div className="flex items-center mb-6">
            <h2 className="text-2xl font-bold text-white">Manage Locker</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Locker Object ID
              </label>
              <input
                type="text"
                value={lockerId}
                onChange={(e) => setLockerId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                placeholder="Enter Locker Object ID"
                disabled={!currentAccount}
              />
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <button
                onClick={withdrawLoan}
                disabled={
                  lockerId.trim() === "" ||
                  coinType.trim() !== "" ||
                  !currentAccount
                }
                className={`py-3 px-6 rounded-xl font-semibold transition-all duration-200 ${
                  lockerId.trim() === "" ||
                  coinType.trim() !== "" ||
                  !currentAccount
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-purple-600 to-violet-600 text-white hover:from-purple-700 hover:to-violet-700 transform hover:scale-[1.02] shadow-lg"
                }`}
              >
                Withdraw SUI
              </button>

              <button
                onClick={withdrawCustomLoan}
                disabled={
                  lockerId.trim() === "" ||
                  coinType.trim() === "" ||
                  !currentAccount
                }
                className={`py-3 px-6 rounded-xl font-semibold transition-all duration-200 ${
                  lockerId.trim() === "" ||
                  coinType.trim() === "" ||
                  !currentAccount
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-red-600 to-rose-600 text-white hover:from-red-700 hover:to-rose-700 transform hover:scale-[1.02] shadow-lg"
                }`}
              >
                Withdraw Custom
              </button>

              <button
                onClick={getLockerInfo}
                disabled={lockerId.trim() === ""}
                className={`py-3 px-6 rounded-xl font-semibold transition-all duration-200 ${
                  lockerId.trim() === ""
                    ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 transform hover:scale-[1.02] shadow-lg"
                }`}
              >
                Get Info
              </button>
            </div>
          </div>
        </div>

        {/* Locker Info Display - Always Visible when info exists */}
        {info && (
          <div className="mt-8 bg-slate-800/50 backdrop-blur-lg rounded-2xl p-6 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                Locker Information
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="bg-slate-700/30 rounded-xl p-4">
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Locker Address
                  </label>
                  <p className="text-white font-mono text-sm break-all">
                    {info[0]}
                  </p>
                </div>
                <div className="bg-slate-700/30 rounded-xl p-4">
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Amount (mist)
                  </label>
                  <p className="text-white font-mono">{info[1]}</p>
                </div>
                <div className="bg-slate-700/30 rounded-xl p-4">
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Duration
                  </label>
                  <p className="text-white">{info[3]} ms</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-700/30 rounded-xl p-4">
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Start Time
                  </label>
                  <p className="text-white">
                    {new Date(Number(info[2])).toLocaleString()}
                  </p>
                </div>
                <div className="bg-slate-700/30 rounded-xl p-4">
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Estimated Release
                  </label>
                  <p className="text-white">
                    {new Date(
                      Number(info[2]) + Number(info[3])
                    ).toLocaleString()}
                  </p>
                </div>
                <div className="bg-slate-700/30 rounded-xl p-4">
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Status
                  </label>
                  <div className="flex items-center">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        new Date() >=
                        new Date(Number(info[2]) + Number(info[3]))
                          ? "bg-green-500/20 text-green-400"
                          : "bg-amber-500/20 text-amber-400"
                      }`}
                    >
                      {new Date() >= new Date(Number(info[2]) + Number(info[3]))
                        ? "✅ Ready to withdraw"
                        : "⏳ Locked"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
