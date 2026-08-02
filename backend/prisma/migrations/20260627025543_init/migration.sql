-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "encryptedSecret" TEXT
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    CONSTRAINT "File_owner_fkey" FOREIGN KEY ("owner") REFERENCES "User" ("owner") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Nonce" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "nonce" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_owner_key" ON "User"("owner");
