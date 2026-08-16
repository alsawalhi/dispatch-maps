import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

const command = new ListBucketsCommand({});

const response = await s3.send(command);

console.log(response.Buckets);
