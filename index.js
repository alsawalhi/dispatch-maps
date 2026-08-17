import express from "express";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const app = express();
const port = 3000;

// Create the basic DynamoDB client.
const dynamoClient = new DynamoDBClient({});

// Wrap it with the Document Client so we can work
// with normal JavaScript objects instead of DynamoDB's
// low-level data format.
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

app.use(express.json());
app.use(express.static("public"));

// System status gives us a simple health-check dashboard.
// A. API server is working
// B. Database connection status
// C. Map service status
const systemStatus = {
  api: "Online",
  database: "DynamoDB connected",
  mapService: "Ready",
};

app.get("/api/status", (req, res) => {
  res.json(systemStatus);
});

app.get("/", (req, res) => {
  res.render("index.ejs");
});

// Returns all units from DynamoDB.
app.get("/api/units", async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: "DispatchMapsUnits",
    });

    const response = await dynamoDB.send(command);

    res.json(response.Items);
  } catch (error) {
    console.error("Error reading units from DynamoDB:", error);

    res.status(500).json({
      message: "Unable to retrieve units",
    });
  }
});

// Returns one unit by its ID.
// We will connect this route to DynamoDB in the next step.
app.get("/api/units/:id", (req, res) => {
  res.status(501).json({
    message: "Single unit DynamoDB lookup not implemented yet",
  });
});

// Creates a new unit.
// We will connect this route to DynamoDB later.
app.post("/api/units", (req, res) => {
  res.status(501).json({
    message: "Create unit DynamoDB operation not implemented yet",
  });
});

// Updates a unit's GPS location.
// Later, a Raspberry Pi can send latitude and longitude here.
app.post("/api/units/:id/location", (req, res) => {
  res.status(501).json({
    message: "GPS DynamoDB update not implemented yet",
  });
});

// Deletes one unit by its ID.
// We will connect this route to DynamoDB later.
app.delete("/api/units/:id", (req, res) => {
  res.status(501).json({
    message: "Delete unit DynamoDB operation not implemented yet",
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
