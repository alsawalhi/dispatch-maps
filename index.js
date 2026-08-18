import express from "express";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const app = express();
const port = 3000;

// =====================================================
// DYNAMODB CLIENT
// =====================================================

// Create the basic DynamoDB client.
const dynamoClient = new DynamoDBClient({});

// Wrap the basic client with the Document Client.
// This lets us work with normal JavaScript objects.
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

// DynamoDB table name.
const tableName = "DispatchMapsUnits";


// =====================================================
// EXPRESS MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.static("public"));


// =====================================================
// SYSTEM STATUS
// =====================================================

// System status gives us a simple health-check dashboard.
// A. API server is working
// B. Database connection status
// C. Map service status
const systemStatus = {
  api: "Online",
  database: "DynamoDB connected",
  mapService: "Ready",
};


// =====================================================
// STATUS API
// =====================================================

app.get("/api/status", (req, res) => {
  res.json(systemStatus);
});


// =====================================================
// HOME PAGE
// =====================================================

app.get("/", (req, res) => {
  res.render("index.ejs");
});


// =====================================================
// GET ALL UNITS
// =====================================================

// Returns all units from DynamoDB.
app.get("/api/units", async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: tableName,
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


// =====================================================
// GET ONE UNIT
// =====================================================

// Returns one unit by its ID from DynamoDB.
app.get("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseInt(req.params.id);

    const command = new GetCommand({
      TableName: tableName,

      Key: {
        id: unitId,
      },
    });

    const response = await dynamoDB.send(command);

    if (!response.Item) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    res.json(response.Item);
  } catch (error) {
    console.error("Error reading unit from DynamoDB:", error);

    res.status(500).json({
      message: "Unable to retrieve unit",
    });
  }
});


// =====================================================
// CREATE NEW UNIT
// =====================================================

// Creates a new unit in DynamoDB.
app.post("/api/units", async (req, res) => {
  try {
    // Get the existing units so we can determine
    // the next available numeric ID.
    const scanCommand = new ScanCommand({
      TableName: tableName,
    });

    const scanResponse = await dynamoDB.send(scanCommand);

    const units = scanResponse.Items || [];

    // Find the highest current ID.
    const highestId =
      units.length > 0
        ? Math.max(...units.map((unit) => unit.id))
        : 0;

    const newUnit = {
      id: highestId + 1,
      name: req.body.name,
      status: req.body.status,
      location: null,
    };

    const command = new PutCommand({
      TableName: tableName,
      Item: newUnit,
    });

    await dynamoDB.send(command);

    res.status(201).json(newUnit);
  } catch (error) {
    console.error("Error creating unit in DynamoDB:", error);

    res.status(500).json({
      message: "Unable to create unit",
    });
  }
});


// =====================================================
// UPDATE UNIT GPS LOCATION
// =====================================================

// Updates a unit's GPS location in DynamoDB.
// Later, a Raspberry Pi can send latitude and longitude here.
app.post("/api/units/:id/location", async (req, res) => {
  try {
    const unitId = parseInt(req.params.id);

    const location = {
      latitude: req.body.latitude,
      longitude: req.body.longitude,
    };

    const command = new UpdateCommand({
      TableName: tableName,

      Key: {
        id: unitId,
      },

      UpdateExpression: "SET #location = :location",

      ExpressionAttributeNames: {
        "#location": "location",
      },

      ExpressionAttributeValues: {
        ":location": location,
      },

      // Prevent DynamoDB from accidentally creating
      // a brand-new unit if the ID does not exist.
      ConditionExpression: "attribute_exists(id)",

      // Return the updated unit after the change.
      ReturnValues: "ALL_NEW",
    });

    const response = await dynamoDB.send(command);

    res.json(response.Attributes);
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    console.error(
      "Error updating unit location in DynamoDB:",
      error
    );

    res.status(500).json({
      message: "Unable to update unit location",
    });
  }
});


// =====================================================
// DELETE UNIT
// =====================================================

// Deletes one unit from DynamoDB by its ID.
app.delete("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseInt(req.params.id);

    const command = new DeleteCommand({
      TableName: tableName,

      Key: {
        id: unitId,
      },

      // Return the deleted item so we can confirm
      // exactly what DynamoDB removed.
      ReturnValues: "ALL_OLD",
    });

    const response = await dynamoDB.send(command);

    if (!response.Attributes) {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    res.json({
      message: "Unit deleted",
      unit: response.Attributes,
    });
  } catch (error) {
    console.error("Error deleting unit from DynamoDB:", error);

    res.status(500).json({
      message: "Unable to delete unit",
    });
  }
});


// =====================================================
// START SERVER
// =====================================================

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
