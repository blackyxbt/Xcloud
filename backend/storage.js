require("dotenv").config();

const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const endpoint = process.env.R2_ENDPOINT?.startsWith("http")
    ? process.env.R2_ENDPOINT
    : `https://${process.env.R2_ENDPOINT}`

const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const bucket = process.env.R2_BUCKET;

async function uploadFile(key, buffer, contentType) {
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        })
    );
}

async function downloadFile(key) {
    return await client.send(
        new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        })
    );
}

async function deleteFile(key) {
    await client.send(
        new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
        })
    );
}

module.exports = {
    uploadFile,
    downloadFile,
    deleteFile,
};
