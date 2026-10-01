CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_txHash_key" ON "Payment"("txHash");
CREATE INDEX "Payment_owner_idx" ON "Payment"("owner");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User"("owner") ON DELETE RESTRICT ON UPDATE CASCADE;
