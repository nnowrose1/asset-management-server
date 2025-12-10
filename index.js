require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const express = require("express");
const cors = require("cors");

// var admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.db_username}:${process.env.db_password}@cluster0.fawnknm.mongodb.net/?appName=Cluster0`;

// function to generate trackingID
function generateTrackingId() {
  const prefix = "asset"; // change to your brand name if needed
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = Math.random().toString(36).substring(2, 10).toUpperCase(); // 8 chars
  return `${prefix}-${date}-${random}`;
}

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
    const assignedAssetsCollection = db.collection("assignedAssets");

    // middleware with database access to verify hr before allowing hr activity. Must be used after verifyJWTToken middleware
    const verifyHR = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "hr") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

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

    // updating an employee info
    app.patch("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedInfo = req.body;

      const updatedFields = {
        updatedAt: new Date(),
      };

      if (updatedInfo.name) {
        updatedFields.name = updatedInfo.name;
      }
      if (updatedInfo.photoURL) {
        updatedFields.photoURL = updatedInfo.photoURL;
      }
      if (updatedInfo.companyLogo) {
        updatedFields.companyLogo = updatedInfo.companyLogo;
      }
      if (updatedInfo.dateOfBirth) {
        updatedFields.dateOfBirth = updatedInfo.dateOfBirth;
      }

      const update = {
        $set: updatedFields,
      };
      const result = await usersCollection.updateOne(query, update);
      res.send(result);
    });

    // getting the packages form DB
    app.get("/packages", async (req, res) => {
      const result = await packageCollection.find().toArray();
      res.send(result);
    });

    // getting a particular package
    app.get("/packages/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await packageCollection.findOne(query);
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

    // getting a particular asset from DB
    app.get("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assetCollection.findOne(query);
      res.send(result);
    });

    // updating the available quantity of an asset
    app.patch("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const updated = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: {
          availableQuantity: updated.availableQuantity,
        },
      };
      const result = await assetCollection.updateOne(query, update);
      res.send(result);
    });

    // deleting an asset
    app.delete("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assetCollection.deleteOne(query);
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
    app.get("/requests", async (req, res) => {
      //  console.log("received Query", req.query);
      const { requesterEmail, hrEmail, requestStatus } = req.query;
      const query = {};
      if (requesterEmail) {
        query.requesterEmail = requesterEmail;
      }
      if (hrEmail) {
        query.hrEmail = hrEmail;
      }
      if (requestStatus) {
        query.requestStatus = requestStatus;
      }
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

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

      // increase user's currentEmployee's by 1
      const userQuery = { _id: new ObjectId(updatedStatus.userId) };
      const user = await usersCollection.findOne(userQuery);
      if (user.currentEmployees > user.packageLimit) {
        return res.send({
          success: false,
          message: "Package limit exceeded!",
        });
      }
      const currentEmployeeUpdate = {
        $inc: {
          currentEmployees: 1,
        },
      };
      const increaseCurrentEmployee = await usersCollection.updateOne(
        userQuery,
        currentEmployeeUpdate
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
        increaseCurrentEmployee,
        insertEmployeeAffiliation,
      });
    });

    // getting all the employees associated with a company
    app.get("/employees", async (req, res) => {
      const email = req.query.email;
      const companyName = req.query.companyName;
      const query = {};
      if (email) {
        query.hrEmail = email;
      }
      if (companyName) {
        query.companyName = companyName;
      }
      // const query = {hrEmail: email}
      const result = await employeeAffiliations.find(query).toArray();
      res.send(result);
    });

    // getting all the companies an employee is associated with
    app.get("/companies", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.employeeEmail = email;
      }
      const companyAffiliations = await employeeAffiliations
        .find(query)
        .toArray();
      const companies = [
        ...new Set(companyAffiliations.map((a) => a.companyName)),
      ];
      res.send(companies);
    });

    // deleting an employee from company
    app.delete("/employees", async (req, res) => {
      const { hrEmail, employeeEmail } = req.query;
      const query = {};
      if (hrEmail) {
        query.hrEmail = hrEmail;
      }
      if (employeeEmail) {
        query.employeeEmail = employeeEmail;
      }

      const result = await employeeAffiliations.deleteOne(query);
      res.send(result);
    });

    // posting assignedAssets to DB
    app.post("/assignedAssets", async (req, res) => {
      const assignedAsset = req.body;
      const result = await assignedAssetsCollection.insertOne(assignedAsset);
      res.send(result);
    });

    // getting assignedAssets from DB
    app.get("/assignedAssets", async (req, res) => {
      const email = req.query.email;
      const query = { employeeEmail: email };
      const result = await assignedAssetsCollection.find(query).toArray();
      res.send(result);
    });

    //Stripe payment related APIS
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const currentPackageLimit = Number(paymentInfo.currentPackageLimit);
      const purchasedPackageLimit = Number(paymentInfo.purchasedPackageLimit);
      const packageLimit = Math.max(currentPackageLimit, purchasedPackageLimit);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.packageName,
              },
            },
            quantity: 1,
          },
        ],

        mode: "payment",
        metadata: {
          name: paymentInfo.packageName,
          packageLimit: packageLimit,
          userId: paymentInfo.userId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/paymentCancelled`,
      });

      // console.log(session);
      res.send({ url: session.url });
    });

    // verifying the payment
    app.patch("/verifyPaymentSuccess", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log("session retrieve", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.userId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            packageLimit: Number(session.metadata.packageLimit),
            subscription: session.metadata.name
          },
        };
        const result = await usersCollection.updateOne(query, update);
       return res.send(result);
      }
      res.send({ success: true });
    });

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
