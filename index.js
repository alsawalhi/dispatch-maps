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

const dynamoClient = new DynamoDBClient({});

const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

const tableName = "DispatchMapsUnits";


// =====================================================
// EXPRESS MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.static("public"));


// =====================================================
// SYSTEM STATUS
// =====================================================

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

app.get("/api/units", async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: tableName,
    });

    const response = await dynamoDB.send(command);

    const units = response.Items || [];

    units.sort((a, b) => a.id - b.id);

    res.json(units);
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

app.post("/api/units", async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name || !status) {
      return res.status(400).json({
        message: "Name and status are required",
      });
    }

    const scanCommand = new ScanCommand({
      TableName: tableName,
    });

    const scanResponse = await dynamoDB.send(scanCommand);

    const units = scanResponse.Items || [];

    const highestId =
      units.length > 0
        ? Math.max(...units.map((unit) => unit.id))
        : 0;

    const newUnit = {
      id: highestId + 1,
      name: name,
      status: status,
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

app.post("/api/units/:id/location", async (req, res) => {
  try {
    const unitId = parseInt(req.params.id);

    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "Latitude and longitude are required",
      });
    }

    const location = {
      latitude: latitude,
      longitude: longitude,
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

      ConditionExpression: "attribute_exists(id)",

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
// REMOVE UNIT GPS LOCATION
// =====================================================

app.delete("/api/units/:id/location", async (req, res) => {
  try {
    const unitId = parseInt(req.params.id);

    const command = new UpdateCommand({
      TableName: tableName,

      Key: {
        id: unitId,
      },

      UpdateExpression: "REMOVE #location",

      ExpressionAttributeNames: {
        "#location": "location",
      },

      ConditionExpression: "attribute_exists(id)",

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
      "Error removing unit location from DynamoDB:",
      error
    );

    res.status(500).json({
      message: "Unable to remove unit location",
    });
  }
});


// =====================================================
// DELETE UNIT
// =====================================================

app.delete("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseInt(req.params.id);

    const command = new DeleteCommand({
      TableName: tableName,

      Key: {
        id: unitId,
      },

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
