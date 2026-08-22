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

// Low-level DynamoDB client.
const dynamoClient = new DynamoDBClient({});

// Document Client lets us work with normal JavaScript objects.
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

// DynamoDB table used by Dispatch Maps.
const tableName = "DispatchMapsUnits";


// =====================================================
// EXPRESS MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.static("public"));


// =====================================================
// HELPER FUNCTIONS
// =====================================================

// Keeps API responses in a clean, predictable order.
function formatUnit(unit) {
  const formattedUnit = {
    id: unit.id,
    name: unit.name,
    status: unit.status,
  };

  if (unit.location) {
    formattedUnit.location = {
      latitude: unit.location.latitude,
      longitude: unit.location.longitude,
    };
  }

  return formattedUnit;
}


// Converts a URL ID into a number and checks that it is valid.
function parseUnitId(id) {
  const unitId = Number(id);

  if (!Number.isInteger(unitId) || unitId <= 0) {
    return null;
  }

  return unitId;
}


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

// GET /api/status
// Returns general application health information.
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

// GET /api/units
// DynamoDB command: ScanCommand
//
// Reads all units from the table.
app.get("/api/units", async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: tableName,
    });

    const response = await dynamoDB.send(command);

    const units = response.Items || [];

    // Scan does not guarantee order.
    units.sort((a, b) => a.id - b.id);

    const formattedUnits = units.map((unit) => formatUnit(unit));

    res.status(200).json(formattedUnits);
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

// GET /api/units/:id
// DynamoDB command: GetCommand
//
// Reads one unit using its partition key.
app.get("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

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

    res.status(200).json(formatUnit(response.Item));
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

// POST /api/units
// DynamoDB command: PutCommand
//
// Request body example:
// {
//   "name": "Unit 05",
//   "status": "Available"
// }
app.post("/api/units", async (req, res) => {
  try {
    const { name, status } = req.body;

    // Required-field validation.
    if (!name || !status) {
      return res.status(400).json({
        message: "Name and status are required",
      });
    }

    // Read current units so we can determine
    // the next numeric ID for this learning project.
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

      // Prevent accidental overwrite if that ID already exists.
      ConditionExpression: "attribute_not_exists(id)",
    });

    await dynamoDB.send(command);

    res.status(201).json(formatUnit(newUnit));
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(409).json({
        message: "A unit with this ID already exists",
      });
    }

    console.error("Error creating unit in DynamoDB:", error);

    res.status(500).json({
      message: "Unable to create unit",
    });
  }
});


// =====================================================
// UPDATE UNIT NAME / STATUS
// =====================================================

// PATCH /api/units/:id
// DynamoDB command: UpdateCommand
//
// PATCH means partially update an existing resource.
//
// Request body examples:
//
// {
//   "status": "Unavailable"
// }
//
// or:
//
// {
//   "name": "Unit 04A",
//   "status": "Available"
// }
app.patch("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

    const { name, status } = req.body;

    // At least one field must be supplied.
    if (name === undefined && status === undefined) {
      return res.status(400).json({
        message: "Name or status is required",
      });
    }

    // Reject empty values if they are supplied.
    if (name !== undefined && !name) {
      return res.status(400).json({
        message: "Name cannot be empty",
      });
    }

    if (status !== undefined && !status) {
      return res.status(400).json({
        message: "Status cannot be empty",
      });
    }

    const updateParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (name !== undefined) {
      updateParts.push("#name = :name");

      expressionAttributeNames["#name"] = "name";
      expressionAttributeValues[":name"] = name;
    }

    if (status !== undefined) {
      updateParts.push("#status = :status");

      expressionAttributeNames["#status"] = "status";
      expressionAttributeValues[":status"] = status;
    }

    const command = new UpdateCommand({
      TableName: tableName,

      Key: {
        id: unitId,
      },

      UpdateExpression: `SET ${updateParts.join(", ")}`,

      ExpressionAttributeNames: expressionAttributeNames,

      ExpressionAttributeValues: expressionAttributeValues,

      // Do not create a new item if the ID does not exist.
      ConditionExpression: "attribute_exists(id)",

      // Return the complete updated unit.
      ReturnValues: "ALL_NEW",
    });

    const response = await dynamoDB.send(command);

    res.status(200).json(formatUnit(response.Attributes));
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    console.error("Error updating unit in DynamoDB:", error);

    res.status(500).json({
      message: "Unable to update unit",
    });
  }
});


// =====================================================
// UPDATE UNIT GPS LOCATION
// =====================================================

// POST /api/units/:id/location
// DynamoDB command: UpdateCommand
//
// Request body example:
// {
//   "latitude": 32.7767,
//   "longitude": -96.797
// }
app.post("/api/units/:id/location", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "Latitude and longitude are required",
      });
    }

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number"
    ) {
      return res.status(400).json({
        message: "Latitude and longitude must be numbers",
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        message: "Latitude must be between -90 and 90",
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        message: "Longitude must be between -180 and 180",
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

    res.status(200).json(formatUnit(response.Attributes));
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

// DELETE /api/units/:id/location
// DynamoDB command: UpdateCommand
//
// Removes only the location attribute.
// The unit itself remains in DynamoDB.
app.delete("/api/units/:id/location", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

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

    res.status(200).json(formatUnit(response.Attributes));
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

// DELETE /api/units/:id
// DynamoDB command: DeleteCommand
//
// Deletes the entire unit.
app.delete("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

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

    res.status(200).json({
      message: "Unit deleted",
      unit: formatUnit(response.Attributes),
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
