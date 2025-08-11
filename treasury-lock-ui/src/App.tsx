import { useState } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

// Constants for Move contract components
const PACKAGE_ID = "0x1c48c1769a145b5c0b79f2f7f7668a6c2bf1161df7bb0a7548ce968bd4c9a76a";
const MODULE_NAME = "lock";
const CLOCK_OBJECT_ID = "0x6";

// Initialize Sui client to interact with the blockchain
const client = new SuiClient({ url: getFullnodeUrl("testnet") });

export default function App() {
  const currentAccount = useCurrentAccount();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

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
  const isCustomLendDisabled = !currentAccount || !coinType || !customAmount || customAmount <= 0;

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

      const result = await signAndExecuteTransaction({
        transaction: tx,
      }) as any;

      console.log("Lend result:", result);

      const digest = result?.digest || result?.effects?.transactionDigest;
      const txBlock = await client.getTransactionBlock({
        digest,
        options: { showObjectChanges: true },
      }) as any;

      const createdObjects = txBlock.objectChanges?.filter((c: any) => c.type === "created");
      const lockerObj = createdObjects?.find((c: any) =>
        c.objectType.includes("Locker<0x2::sui::SUI>")
      );

      if (lockerObj) {
        setLockerId(lockerObj.objectId);
        alert(`Lend successful! Locker ID: ${lockerObj.objectId}`);
      } else {
        alert("Lend successful, but no Locker object was found.");
      }

      setAmountInput("");
      setDuration(5);
    } catch (error) {
      console.error("Lend failed:", error);
      alert("Lend failed.");
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

      const coinObj = coins.data.find(c => BigInt(c.balance) >= BigInt(customAmount * 1_000_000_000));
      if (!coinObj) {
        alert(`No single coin object has enough balance for ${customAmount} units.`);
        return;
      }

      const tx = new Transaction();
      tx.setGasBudget(100000000);

      const [splitCoin] = tx.splitCoins(
        tx.object(coinObj.coinObjectId),
        [tx.pure.u64(BigInt(customAmount * 1_000_000_000))]
      );

      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::lend`,
        typeArguments: [coinType],
        arguments: [splitCoin, tx.pure.u64(customDuration), tx.object(CLOCK_OBJECT_ID)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx }) as any;
      console.log("Custom lend result:", result);

      const digest = result?.digest || result?.effects?.transactionDigest;
      const txBlock = await client.getTransactionBlock({
        digest,
        options: { showObjectChanges: true },
      }) as any;

      const createdObjects = txBlock.objectChanges?.filter((c: any) => c.type === "created");
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

      const result = await signAndExecuteTransaction({ transaction: tx }) as any;
      console.log("Withdraw result:", result);

      const status = result?.effects?.status?.status;
      const errorMessage = result?.effects?.status?.error;

      if (status === "failure") {
        console.error("Withdraw failed:", errorMessage);
        if (errorMessage?.toLowerCase().includes("code 2")) {
          alert("Error: It’s too early to withdraw. Please wait until the lock duration ends.");
        } else {
          alert(`Withdraw failed: ${errorMessage}`);
        }
        return;
      }

      alert("Withdraw successful!");
    } catch (error: any) {
      console.error("Withdraw failed:", error);
      const serialized = error?.toString() || "";
      if (serialized.includes("code 2")) {
        alert("Error: It’s too early to withdraw. Please wait until the lock duration ends.");
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

      const result = await signAndExecuteTransaction({ transaction: tx }) as any;
      console.log("Withdraw result:", result);

      const status = result?.effects?.status?.status;
      const errorMessage = result?.effects?.status?.error;

      if (status === "failure") {
        console.error("Withdraw failed:", errorMessage);
        if (errorMessage?.toLowerCase().includes("code 2")) {
          alert("Error: It’s too early to withdraw. Please wait until the lock duration ends.");
        } else {
          alert(`Withdraw failed: ${errorMessage}`);
        }
        return;
      }

      alert("Withdraw successful!");
    } catch (error: any) {
      console.error("Withdraw failed:", error);
      const serialized = error?.toString() || "";
      if (serialized.includes("code 2")) {
        alert("Error: It’s too early to withdraw. Please wait until the lock duration ends.");
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
    <div className="mt-20 bg-gradient-to-r from-black via-gray-900 to-black text-white p-6 max-w-xl mx-auto rounded shadow-xl">
      <h1 className="text-2xl font-bold mb-6 text-center">Treasury Lock</h1>

      <div className="mb-4">
        <ConnectButton />
        {!currentAccount && <p className="text-sm text-gray-400 mt-2">Please connect your wallet</p>}
      </div>

      {currentAccount && (
        <>
          {/* SUI lending section */}
          <div className="mb-6">
            <label className="block mb-1 font-medium">Amount (SUI):</label>
            <input
              type="text"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="border border-gray-600 bg-gray-800 text-white rounded p-2 w-full"
              placeholder="e.g. 1.5"
            />

            <label className="block mt-4 mb-1 font-medium">Duration (minutes):</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="border border-gray-600 bg-gray-800 text-white rounded p-2 w-full"
            />

            <button
              onClick={lend}
              disabled={isLendDisabled}
              className={`mt-4 ${isLendDisabled ? "bg-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                } text-white px-4 py-2 rounded w-full`}
            >
              Lend SUI
            </button>
          </div>

          {/* Custom coin lending section */}
          <div className="mb-6 mt-10 border-t border-gray-700 pt-6">
            <h2 className="text-lg font-semibold mb-4">Lend Custom Coin</h2>

            <label className="block mb-1 font-medium">Coin Type:</label>
            <input
              type="text"
              value={coinType}
              onChange={(e) => setCoinType(e.target.value)}
              className="border border-gray-600 bg-gray-800 text-white rounded p-2 w-full"
              placeholder="e.g. 0xYourPackage::yourcoin::YOURCOIN"
            />

            <label className="block mt-4 mb-1 font-medium">Amount:</label>
            <input
              type="text"
              value={customAmountInput}
              onChange={(e) => setCustomAmountInput(e.target.value)}
              className="border border-gray-600 bg-gray-800 text-white rounded p-2 w-full"
              placeholder="e.g. 50"
            />

            <label className="block mt-4 mb-1 font-medium">Duration (minutes):</label>
            <input
              type="number"
              value={customDuration}
              onChange={(e) => setCustomDuration(parseInt(e.target.value))}
              className="border border-gray-600 bg-gray-800 text-white rounded p-2 w-full"
            />

            <button
              onClick={lendCustomCoin}
              disabled={isCustomLendDisabled}
              className={`mt-4 ${isCustomLendDisabled
                ? "bg-gray-500 cursor-not-allowed"
                : "bg-yellow-600 hover:bg-yellow-700"
                } text-white px-4 py-2 rounded w-full`}
            >
              Lend Custom Coin
            </button>
          </div>

          {/* Locker actions */}
          <div className="mb-6">
            <label className="block mb-1 font-medium">Locker Object ID:</label>
            <input
              type="text"
              value={lockerId}
              onChange={(e) => setLockerId(e.target.value)}
              className="border border-gray-600 bg-gray-800 text-white rounded p-2 w-full"
              placeholder="Enter Locker Object ID"
            />

            <button
              onClick={withdrawLoan}
              disabled={lockerId.trim() === ""}
              className={`mt-4 ${lockerId.trim() === ""
                ? "bg-gray-500 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-700"
                } text-white px-4 py-2 rounded w-full`}
            >
              Withdraw Loan
            </button>

            <button
              onClick={withdrawCustomLoan}
              disabled={lockerId.trim() === "" || !coinType}
              className={`mt-4 ${lockerId.trim() === "" || !coinType
                ? "bg-gray-500 cursor-not-allowed"
                : "bg-red-600 hover:bg-red-700"
                } text-white px-4 py-2 rounded w-full`}
            >
              Withdraw Custom Loan
            </button>


            <button
              onClick={getLockerInfo}
              disabled={lockerId.trim() === ""}
              className={`mt-2 ${lockerId.trim() === ""
                ? "bg-gray-500 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700"
                } text-white px-4 py-2 rounded w-full`}
            >
              Get Locker Info
            </button>
          </div>

          {/* Locker info display */}
          <div className="mb-6">
            {info && (
              <>
                <h2 className="text-lg font-semibold mb-2">Locker Info</h2>
                <div className="mt-4 bg-gray-800 p-4 rounded text-sm">
                  <p><strong>Lender:</strong> {info[0]}</p>
                  <p><strong>Amount (mist):</strong> {info[1]}</p>
                  <p><strong>Start Time:</strong> {info[2]}</p>
                  <p><strong>Start Date:</strong> {new Date(Number(info[2])).toLocaleString()}</p>
                  <p><strong>Duration:</strong> {info[3]}</p>
                  <p><strong>Estimated Release:</strong> {new Date(Number(info[2]) + Number(info[3])).toLocaleString()}</p>
                  <p><strong>Status:</strong> <span className={new Date() >= new Date(Number(info[2]) + Number(info[3])) ? "text-green-400" : "text-yellow-400"}>
                    {new Date() >= new Date(Number(info[2]) + Number(info[3])) ? "Ready to withdraw" : "Not ready yet"}
                  </span></p>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
