import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("anchor-amm-q4-25", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorAmmQ425 as Program<AnchorAmmQ425>;
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  // Test accounts
  let mintX: PublicKey;
  let mintY: PublicKey;
  let mintLp: PublicKey;
  let userXAccount: PublicKey;
  let userYAccount: PublicKey;
  let userLpAccount: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;
  let config: PublicKey;

  // Test parameters
  const seed = new BN(1);
  const fee = 300; // 3% fee (300 basis points)
  const initialLiquidityX = new BN(1000000); // 1 million tokens
  const initialLiquidityY = new BN(1000000); // 1 million tokens

  before(async () => {
    // Create Mint X
    mintX = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6 // 6 decimals
    );

    // Create Mint Y
    mintY = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6 // 6 decimals
    );

    // Derive config PDA
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Derive LP mint PDA
    [mintLp] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    );

    // Create user token accounts
    userXAccount = await createAccount(
      connection,
      wallet.payer,
      mintX,
      wallet.publicKey
    );

    userYAccount = await createAccount(
      connection,
      wallet.payer,
      mintY,
      wallet.publicKey
    );

    // Mint tokens to user
    await mintTo(
      connection,
      wallet.payer,
      mintX,
      userXAccount,
      wallet.publicKey,
      10000000000 // 10 billion tokens
    );

    await mintTo(
      connection,
      wallet.payer,
      mintY,
      userYAccount,
      wallet.publicKey,
      10000000000 // 10 billion tokens
    );

    // Derive vault addresses (ATAs)
    vaultX = PublicKey.findProgramAddressSync(
      [
        config.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintX.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    vaultY = PublicKey.findProgramAddressSync(
      [
        config.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintY.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    // Derive user LP token account
    userLpAccount = PublicKey.findProgramAddressSync(
      [
        wallet.publicKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintLp.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    console.log("Setup complete!");
    console.log("Mint X:", mintX.toString());
    console.log("Mint Y:", mintY.toString());
    console.log("Config:", config.toString());
    console.log("LP Mint:", mintLp.toString());
  });

  it("Initialize AMM pool", async () => {
    const tx = await program.methods
      .initialize(seed, fee, null)
      .accounts({
        initializer: wallet.publicKey,
        mintX: mintX,
        mintY: mintY,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        config: config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize transaction signature:", tx);

    // Verify config account
    const configAccount = await program.account.config.fetch(config);
    assert.equal(configAccount.seed.toString(), seed.toString());
    assert.equal(configAccount.fee, fee);
    assert.equal(configAccount.mintX.toString(), mintX.toString());
    assert.equal(configAccount.mintY.toString(), mintY.toString());
    assert.equal(configAccount.locked, false);

    console.log("✓ Pool initialized successfully");
  });

  it("Deposit initial liquidity", async () => {
    const depositAmount = new BN(1000000); // 1 million LP tokens

    const tx = await program.methods
      .deposit(depositAmount, initialLiquidityX, initialLiquidityY)
      .accounts({
        user: wallet.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: config,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userXAccount,
        userY: userYAccount,
        userLp: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Deposit transaction signature:", tx);

    // Verify vault balances
    const vaultXAccount = await getAccount(connection, vaultX);
    const vaultYAccount = await getAccount(connection, vaultY);
    assert.equal(
      vaultXAccount.amount.toString(),
      initialLiquidityX.toString()
    );
    assert.equal(
      vaultYAccount.amount.toString(),
      initialLiquidityY.toString()
    );

    // Verify LP tokens minted
    const userLpAccountData = await getAccount(connection, userLpAccount);
    assert.equal(userLpAccountData.amount.toString(), depositAmount.toString());

    console.log("✓ Initial liquidity deposited successfully");
  });

  it("Deposit additional liquidity", async () => {
    const additionalDeposit = new BN(500000); // 500k LP tokens
    const maxX = new BN(600000); // Max 600k token X
    const maxY = new BN(600000); // Max 600k token Y

    const vaultXBefore = await getAccount(connection, vaultX);
    const vaultYBefore = await getAccount(connection, vaultY);
    const userLpBefore = await getAccount(connection, userLpAccount);

    const tx = await program.methods
      .deposit(additionalDeposit, maxX, maxY)
      .accounts({
        user: wallet.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: config,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userXAccount,
        userY: userYAccount,
        userLp: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Additional deposit transaction signature:", tx);

    // Verify LP tokens increased
    const userLpAfter = await getAccount(connection, userLpAccount);
    assert.equal(
      userLpAfter.amount.toString(),
      (BigInt(userLpBefore.amount.toString()) + BigInt(additionalDeposit.toString())).toString()
    );

    console.log("✓ Additional liquidity deposited successfully");
  });

  it("Swap X for Y", async () => {
    const swapAmountX = new BN(10000); // 10k token X
    const minAmountOutY = new BN(9000); // Expect at least 9k token Y (accounting for slippage and fees)

    const userXBefore = await getAccount(connection, userXAccount);
    const userYBefore = await getAccount(connection, userYAccount);

    const tx = await program.methods
      .swap(true, swapAmountX, minAmountOutY)
      .accounts({
        user: wallet.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: config,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userXAccount,
        userY: userYAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Swap X->Y transaction signature:", tx);

    // Verify balances changed
    const userXAfter = await getAccount(connection, userXAccount);
    const userYAfter = await getAccount(connection, userYAccount);

    const xSpent = BigInt(userXBefore.amount.toString()) - BigInt(userXAfter.amount.toString());
    const yReceived = BigInt(userYAfter.amount.toString()) - BigInt(userYBefore.amount.toString());

    assert.equal(xSpent.toString(), swapAmountX.toString());
    assert(yReceived > BigInt(0), "Should receive Y tokens");
    assert(yReceived >= BigInt(minAmountOutY.toString()), "Should receive at least minimum Y");

    console.log(`✓ Swapped ${xSpent} X for ${yReceived} Y`);
  });

  it("Swap Y for X", async () => {
    const swapAmountY = new BN(10000); // 10k token Y
    const minAmountOutX = new BN(9000); // Expect at least 9k token X

    const userXBefore = await getAccount(connection, userXAccount);
    const userYBefore = await getAccount(connection, userYAccount);

    const tx = await program.methods
      .swap(false, swapAmountY, minAmountOutX)
      .accounts({
        user: wallet.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: config,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userXAccount,
        userY: userYAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Swap Y->X transaction signature:", tx);

    // Verify balances changed
    const userXAfter = await getAccount(connection, userXAccount);
    const userYAfter = await getAccount(connection, userYAccount);

    const ySpent = BigInt(userYBefore.amount.toString()) - BigInt(userYAfter.amount.toString());
    const xReceived = BigInt(userXAfter.amount.toString()) - BigInt(userXBefore.amount.toString());

    assert.equal(ySpent.toString(), swapAmountY.toString());
    assert(xReceived > BigInt(0), "Should receive X tokens");
    assert(xReceived >= BigInt(minAmountOutX.toString()), "Should receive at least minimum X");

    console.log(`✓ Swapped ${ySpent} Y for ${xReceived} X`);
  });

  it("Withdraw liquidity", async () => {
    const withdrawAmount = new BN(100000); // Withdraw 100k LP tokens
    const minX = new BN(80000); // Expect at least 80k token X
    const minY = new BN(80000); // Expect at least 80k token Y

    const userXBefore = await getAccount(connection, userXAccount);
    const userYBefore = await getAccount(connection, userYAccount);
    const userLpBefore = await getAccount(connection, userLpAccount);

    const tx = await program.methods
      .withdraw(withdrawAmount, minX, minY)
      .accounts({
        user: wallet.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: config,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userXAccount,
        userY: userYAccount,
        userLp: userLpAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Withdraw transaction signature:", tx);

    // Verify LP tokens burned
    const userLpAfter = await getAccount(connection, userLpAccount);
    const lpBurned = BigInt(userLpBefore.amount.toString()) - BigInt(userLpAfter.amount.toString());
    assert.equal(lpBurned.toString(), withdrawAmount.toString());

    // Verify tokens received
    const userXAfter = await getAccount(connection, userXAccount);
    const userYAfter = await getAccount(connection, userYAccount);

    const xReceived = BigInt(userXAfter.amount.toString()) - BigInt(userXBefore.amount.toString());
    const yReceived = BigInt(userYAfter.amount.toString()) - BigInt(userYBefore.amount.toString());

    assert(xReceived > BigInt(0), "Should receive X tokens");
    assert(yReceived > BigInt(0), "Should receive Y tokens");
    assert(xReceived >= BigInt(minX.toString()), "Should receive at least minimum X");
    assert(yReceived >= BigInt(minY.toString()), "Should receive at least minimum Y");

    console.log(`✓ Withdrew liquidity: ${xReceived} X and ${yReceived} Y for ${lpBurned} LP tokens`);
  });

  it("Fail to swap with insufficient output (slippage protection)", async () => {
    const swapAmountX = new BN(10000);
    const unrealisticMinOut = new BN(1000000); // Unrealistically high minimum

    try {
      await program.methods
        .swap(true, swapAmountX, unrealisticMinOut)
        .accounts({
          user: wallet.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userXAccount,
          userY: userYAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      assert.fail("Should have failed due to slippage");
    } catch (err) {
      assert(err.toString().includes("SlippageExceeded"));
      console.log("✓ Slippage protection working correctly");
    }
  });

  it("Fail to deposit with zero amount", async () => {
    const zeroAmount = new BN(0);

    try {
      await program.methods
        .deposit(zeroAmount, new BN(1000), new BN(1000))
        .accounts({
          user: wallet.publicKey,
          mintX: mintX,
          mintY: mintY,
          config: config,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userXAccount,
          userY: userYAccount,
          userLp: userLpAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      assert.fail("Should have failed with zero amount");
    } catch (err) {
      assert(err.toString().includes("InvalidAmount"));
      console.log("✓ Zero amount validation working correctly");
    }
  });
});
