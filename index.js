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

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const app = express();
const port = 3000;

// =====================================================
// DYNAMODB CLIENT
// =====================================================

const dynamoClient = new DynamoDBClient({});

const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

const tableName = "DispatchMapsUnits";


// =====================================================
// S3 CLIENT
// =====================================================

const s3 = new S3Client({});

const bucketName =
  "dispatchmaps-420404496340-us-east-1-an";


// =====================================================
// EXPRESS MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.static("public"));


// =====================================================
// HELPER FUNCTIONS
// =====================================================

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


function parseUnitId(id) {
  const unitId = Number(id);

  if (!Number.isInteger(unitId) || unitId <= 0) {
    return null;
  }

  return unitId;
}


// =====================================================
// S3 BACKUP / EXPORT FUNCTION
// =====================================================

async function exportUnitsToS3() {
  const scanCommand = new ScanCommand({
    TableName: tableName,
  });

  const scanResponse = await dynamoDB.send(scanCommand);

  const units = scanResponse.Items || [];

  units.sort((a, b) => a.id - b.id);

  const formattedUnits = units.map((unit) => formatUnit(unit));

  const jsonData = JSON.stringify(formattedUnits, null, 2);


  // ===================================================
  // LATEST COPY
  // ===================================================

  const latestCommand = new PutObjectCommand({
    Bucket: bucketName,

    Key: "exports/units.json",

    Body: jsonData,

    ContentType: "application/json",
  });

  const latestResponse = await s3.send(latestCommand);


  // ===================================================
  // TIMESTAMPED HISTORY COPY
  // ===================================================

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\./g, "-");

  const historyKey =
    `exports/history/units-${timestamp}.json`;

  const historyCommand = new PutObjectCommand({
    Bucket: bucketName,

    Key: historyKey,

    Body: jsonData,

    ContentType: "application/json",
  });

  await s3.send(historyCommand);


  return {
    unitCount: formattedUnits.length,
    latestKey: "exports/units.json",
    historyKey: historyKey,
    versionId: latestResponse.VersionId,
  };
}


// =====================================================
// SYSTEM STATUS
// =====================================================

const systemStatus = {
  api: "Online",
  database: "DynamoDB connected",
  mapService: "Ready",
  storage: "S3 connected",
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

      ConditionExpression: "attribute_not_exists(id)",
    });

    await dynamoDB.send(command);

    const backup = await exportUnitsToS3();

    res.status(201).json({
      unit: formatUnit(newUnit),
      s3Backup: backup,
    });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(409).json({
        message: "A unit with this ID already exists",
      });
    }

    console.error("Error creating unit:", error);

    res.status(500).json({
      message: "Unable to create unit",
    });
  }
});


// =====================================================
// UPDATE UNIT NAME / STATUS
// =====================================================

app.patch("/api/units/:id", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

    const { name, status } = req.body;

    if (name === undefined && status === undefined) {
      return res.status(400).json({
        message: "Name or status is required",
      });
    }

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

      UpdateExpression:
        `SET ${updateParts.join(", ")}`,

      ExpressionAttributeNames:
        expressionAttributeNames,

      ExpressionAttributeValues:
        expressionAttributeValues,

      ConditionExpression:
        "attribute_exists(id)",

      ReturnValues: "ALL_NEW",
    });

    const response = await dynamoDB.send(command);

    const backup = await exportUnitsToS3();

    res.status(200).json({
      unit: formatUnit(response.Attributes),
      s3Backup: backup,
    });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    console.error("Error updating unit:", error);

    res.status(500).json({
      message: "Unable to update unit",
    });
  }
});


// =====================================================
// UPDATE UNIT GPS LOCATION
// =====================================================

app.post("/api/units/:id/location", async (req, res) => {
  try {
    const unitId = parseUnitId(req.params.id);

    if (unitId === null) {
      return res.status(400).json({
        message: "Invalid unit ID",
      });
    }

    const { latitude, longitude } = req.body;

    if (
      latitude === undefined ||
      longitude === undefined
    ) {
      return res.status(400).json({
        message:
          "Latitude and longitude are required",
      });
    }

    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number"
    ) {
      return res.status(400).json({
        message:
          "Latitude and longitude must be numbers",
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        message:
          "Latitude must be between -90 and 90",
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        message:
          "Longitude must be between -180 and 180",
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

      UpdateExpression:
        "SET #location = :location",

      ExpressionAttributeNames: {
        "#location": "location",
      },

      ExpressionAttributeValues: {
        ":location": location,
      },

      ConditionExpression:
        "attribute_exists(id)",

      ReturnValues: "ALL_NEW",
    });

    const response = await dynamoDB.send(command);

    const backup = await exportUnitsToS3();

    res.status(200).json({
      unit: formatUnit(response.Attributes),
      s3Backup: backup,
    });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    console.error(
      "Error updating unit location:",
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

      ConditionExpression:
        "attribute_exists(id)",

      ReturnValues: "ALL_NEW",
    });

    const response = await dynamoDB.send(command);

    const backup = await exportUnitsToS3();

    res.status(200).json({
      unit: formatUnit(response.Attributes),
      s3Backup: backup,
    });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        message: "Unit not found",
      });
    }

    console.error(
      "Error removing unit location:",
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

    const backup = await exportUnitsToS3();

    res.status(200).json({
      message: "Unit deleted",

      unit: formatUnit(response.Attributes),

      s3Backup: backup,
    });
  } catch (error) {
    console.error("Error deleting unit:", error);

    res.status(500).json({
      message: "Unable to delete unit",
    });
  }
});


// =====================================================
// MANUAL EXPORT TO S3
// =====================================================

app.post("/api/export/units", async (req, res) => {
  try {
    const backup = await exportUnitsToS3();

    res.status(200).json({
      message:
        "Units exported to S3 successfully",

      ...backup,
    });
  } catch (error) {
    console.error(
      "Error exporting units to S3:",
      error
    );

    res.status(500).json({
      message:
        "Unable to export units to S3",
    });
  }
});


// =====================================================
// GET OBJECT FROM S3
// =====================================================

// GET /api/export/units
//
// Reads:
// exports/units.json
//
// S3 command:
// GetObjectCommand

app.get("/api/export/units", async (req, res) => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,

      Key: "exports/units.json",
    });

    const response = await s3.send(command);

    const jsonText =
      await response.Body.transformToString();

    const units = JSON.parse(jsonText);

    res.status(200).json(units);
  } catch (error) {
    if (
      error.name === "NoSuchKey" ||
      error.name === "NotFound"
    ) {
      return res.status(404).json({
        message: "S3 units export not found",
      });
    }

    console.error(
      "Error reading object from S3:",
      error
    );

    res.status(500).json({
      message:
        "Unable to retrieve object from S3",
    });
  }
});


// =====================================================
// LIST OBJECTS IN S3
// =====================================================

// GET /api/s3/objects
//
// Lists everything under:
//
// exports/
//
// S3 command:
// ListObjectsV2Command

app.get("/api/s3/objects", async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,

      Prefix: "exports/",
    });

    const response = await s3.send(command);

    const objects = response.Contents || [];

    const formattedObjects = objects.map((object) => ({
      key: object.Key,
      size: object.Size,
      lastModified: object.LastModified,
      etag: object.ETag,
    }));

    res.status(200).json({
      bucket: bucketName,
      objectCount: formattedObjects.length,
      objects: formattedObjects,
    });
  } catch (error) {
    console.error(
      "Error listing S3 objects:",
      error
    );

    res.status(500).json({
      message:
        "Unable to list S3 objects",
    });
  }
});


// =====================================================
// DELETE OBJECT FROM S3
// =====================================================

// DELETE /api/s3/object
//
// Request body example:
//
// {
//   "key": "exports/history/units-2026-08-25T06-30-00-000Z.json"
// }
//
// S3 command:
// DeleteObjectCommand
//
// IMPORTANT:
// Because S3 Versioning is enabled,
// deleting a versioned object normally creates
// a delete marker instead of permanently destroying
// every older version.

app.delete("/api/s3/object", async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({
        message: "S3 object key is required",
      });
    }

    // Safety check:
    // Only allow this API to delete objects
    // inside our exports area.
    if (!key.startsWith("exports/")) {
      return res.status(400).json({
        message:
          "Only objects under exports/ can be deleted",
      });
    }

    const command = new DeleteObjectCommand({
      Bucket: bucketName,

      Key: key,
    });

    const response = await s3.send(command);

    res.status(200).json({
      message: "S3 object deleted",
      bucket: bucketName,
      key: key,
      deleteMarker: response.DeleteMarker || false,
      versionId: response.VersionId || null,
    });
  } catch (error) {
    console.error(
      "Error deleting S3 object:",
      error
    );

    res.status(500).json({
      message:
        "Unable to delete S3 object",
    });
  }
});


// =====================================================
// START SERVER
// =====================================================

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
