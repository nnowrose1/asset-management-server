const express = require("express");
const cors = require("cors");
require("dotenv").config();
// var admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// tXP4Di7Wuig1ZKXy    asset_management_user
// middlewares
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.db_username}:${process.env.db_password}@cluster0.fawnknm.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();













    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
  res.send("Asset Management server!");
});

app.listen(port, () => {
  console.log(`Asset Management is listening on port ${port}`);
});
