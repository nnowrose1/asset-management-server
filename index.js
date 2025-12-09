const express = require("express");
const cors = require("cors");
require("dotenv").config();
// var admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

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
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("asset-management-db");
    const usersCollection = db.collection("users");
    const packageCollection = db.collection("packages");
    const assetCollection = db.collection("assets");
    const requestCollection = db.collection("requests");
    const employeeAffiliations = db.collection("company");

    // users related APIs here
    // posting a user to DB
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // getting a particular user from DB
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // getting the role of a user: Hr or Employee
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user?.role);
    });

    // getting the packages form DB
    app.get("/packages", async (req, res) => {
      const result = await packageCollection.find().toArray();
      res.send(result);
    });

    // assets related APIs here
    // posting an asset to DB
    app.post("/assets", async (req, res) => {
      const asset = req.body;
      const result = await assetCollection.insertOne(asset);
      res.send(result);
    });

    // getting assets from DB
    app.get("/assets", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.hrEmail = email;
      }
      const result = await assetCollection.find(query).toArray();
      res.send(result);
    });

    

    // request related APIs here
    // posting a request to DB
    app.post("/requests", async (req, res) => {
      const request = req.body;
      const result = await requestCollection.insertOne(request);
      res.send(result);
    });

     // getting total asset count for a particular employee for a hr for myEmployees page
    app.get('/requests', async(req, res) => {
       console.log("received Query", req.query);
      const { hrEmail, requestStatus} = req.query;   
      const query = {};
      if(hrEmail) {
        query.hrEmail = hrEmail
      }
      if(requestStatus) {
        query.requestStatus = requestStatus
      }
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    })

    // getting the requests for a particular hr
    app.get("/requests/:email", async (req, res) => {
      const email = req.params.email;
      const query = { hrEmail: email };
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    // update the status of request
    app.patch("/requests/:id", async (req, res) => {
      const id = req.params.id;
      const updatedStatus = req.body;
      let insertEmployeeAffiliation = null;
      const statusQuery = { _id: new ObjectId(id) };
      // if rejected
      if (updatedStatus.status === "rejected") {
        const update = {
          $set: {
            requestStatus: updatedStatus.status,
          },
        };
        const statusUpdateResult = await requestCollection.updateOne(
          statusQuery,
          update
        );
        return res.send(statusUpdateResult);
      }

      // if approved
      // decrease asset's available quantity by 1
      const assetQuery = { _id: new ObjectId(updatedStatus.assetId) };
      const asset = await assetCollection.findOne(assetQuery);
      if (asset.availableQuantity <= 0) {
        return res.send({
          success: false,
          message: "No available quantity left",
        });
      }

      const decreaseAssetQuantity = {
        $inc: {
          availableQuantity: -1,
        },
      };

      const assetUpdateResult = await assetCollection.updateOne(
        assetQuery,
        decreaseAssetQuantity
      );

      const update = {
        $set: {
          requestStatus: updatedStatus.status,
          processedBy: updatedStatus.processedBy,
          approvalDate: updatedStatus.date,
        },
      };
      const statusUpdateResult = await requestCollection.updateOne(
        statusQuery,
        update
      );

      // create employee's company affiliation
      if (updatedStatus.companyAffiliation) {
        const companyQuery = {
          employeeEmail: updatedStatus.companyAffiliation.employeeEmail,
          hrEmail: updatedStatus.companyAffiliation.hrEmail,
        };
        const employeeAlreadyAffiliated = await employeeAffiliations.findOne(
          companyQuery
        );

        if (!employeeAlreadyAffiliated) {
          insertEmployeeAffiliation = await employeeAffiliations.insertOne(
            updatedStatus.companyAffiliation
          );
        }
      }
      res.send({
        statusUpdateResult,
        assetUpdateResult,
        insertEmployeeAffiliation,
      });
    });

   

    // getting all the employees associated with a company
    app.get("/employees", async (req, res) => {
      const email = req.query.email;
      const query = {hrEmail: email}
      const result = await employeeAffiliations.find(query).toArray();
      res.send(result);
    });

    // deleting an employee from company
    app.delete('/employees', async(req, res) => {
      const {hrEmail, employeeEmail} = req.query;
      const query = {};
      if(hrEmail){
        query.hrEmail = hrEmail
      }
      if(employeeEmail){
        query.employeeEmail=employeeEmail
      }
     
      const result =await employeeAffiliations.deleteOne(query);
      res.send(result);

    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
