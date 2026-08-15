import express from "express";

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static("public"));

const units = [
  {
    id: 1,
    name: "Unit 01",
    status: "Available",
    location: null,
  },
  {
    id: 2,
    name: "Unit 02",
    status: "Available",
    location: null,
  },
  {
    id: 3,
    name: "Unit 03",
    status: "Unavailable",
    location: null,
  },
];

// System status gives us a simple health-check dashboard.
// A. API server is working
// B. Database connection status
// C. Map service status
const systemStatus = {
  api: "Online",
  database: "Not connected",
  mapService: "Ready",
};

app.get("/api/status", (req, res) => {
  res.json(systemStatus);
});

app.get("/", (req, res) => {
  res.render("index.ejs");
});

// Returns all units.
app.get("/api/units", (req, res) => {
  res.json(units);
});

// Returns one unit by its ID.
app.get("/api/units/:id", (req, res) => {
  const unitId = parseInt(req.params.id);
  const unit = units.find((unit) => unit.id === unitId);

  if (!unit) {
    return res.status(404).json({ message: "Unit not found" });
  }

  res.json(unit);
});

// Creates a new unit.
app.post("/api/units", (req, res) => {
  const newUnit = {
    id: units.length + 1,
    name: req.body.name,
    status: req.body.status,
    location: null,
  };

  units.push(newUnit);

  res.status(201).json(newUnit);
});

// Updates a unit's GPS location.
// Later, a Raspberry Pi can send latitude and longitude here.
app.post("/api/units/:id/location", (req, res) => {
  const unitId = parseInt(req.params.id);
  const unit = units.find((unit) => unit.id === unitId);

  if (!unit) {
    return res.status(404).json({ message: "Unit not found" });
  }

  unit.location = {
    latitude: req.body.latitude,
    longitude: req.body.longitude,
  };

  res.json(unit);
});

// Deletes one unit by its ID.
app.delete("/api/units/:id", (req, res) => {
  const unitId = parseInt(req.params.id);

  const unitIndex = units.findIndex((unit) => unit.id === unitId);

  if (unitIndex === -1) {
    return res.status(404).json({ message: "Unit not found" });
  }

  const deletedUnit = units.splice(unitIndex, 1);

  res.json({
    message: "Unit deleted",
    unit: deletedUnit[0],
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});