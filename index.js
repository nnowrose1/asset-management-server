require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");

// var admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(express.json());

// jwt related APIs here
app.post("/getToken", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "1h" });
  res.send({ token: token });
});

const verifyJWTToken = (req, res, next) => {
  // console.log(req.headers);
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  // verify the token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized Access" });
    }
    // console.log("after decoded", decoded);
    req.token_email = decoded.email;
    next();
  });
};

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
    // await client.connect();

    const db = client.db("asset-management-db");
    const usersCollection = db.collection("users");
    const packageCollection = db.collection("packages");
    const assetCollection = db.collection("assets");
    const requestCollection = db.collection("requests");
    const employeeAffiliations = db.collection("company");
    const assignedAssetsCollection = db.collection("assignedAssets");
    const paymentsCollection = db.collection("payments");

    // middleware with database access to verify hr before allowing hr activity. Must be used after verifyJWTToken middleware
    const verifyHR = async (req, res, next) => {
      const email = req.token_email;
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
    app.get("/users/:email", verifyJWTToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // getting the role of a user: Hr or Employee
    app.get("/users/:email/role", verifyJWTToken, async (req, res) => {
      const email = req.params.email;
      //  if(email !==req.token_email){
      //     return res.status(403).send({message: 'Forbidden Access'});
      //   }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user?.role);
    });

    // updating an employee info
    app.patch("/users/:id", verifyJWTToken, async (req, res) => {
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
    app.post("/assets", verifyJWTToken, verifyHR, async (req, res) => {
      const asset = req.body;
      asset.hrEmail = req.token_email;
      const result = await assetCollection.insertOne(asset);
      res.send(result);
    });

    // getting returnable and non-returnable assets count for a hr
    app.get(
      "/assets/:email/returnableDistribution",
      verifyJWTToken,
      async (req, res) => {
        const email = req.params.email;
        if (email !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
        const data = await assetCollection
          .aggregate([
            { $match: { hrEmail: email } },
            { $group: { _id: "$productType", count: { $sum: 1 } } },
            { $project: { type: "$_id", count: 1, _id: 0 } },
          ])
          .toArray();

        res.send(data);
      }
    );

    // getting assets from DB
    app.get("/assets", verifyJWTToken, async (req, res) => {
      const { email, limit = 0, page = 1 } = req.query;
      // console.log({email: email, tokenEmail: req.token_email});
      const skip = page - 1;
      const query = {};
      if (email) {
        if (email !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }

        query.hrEmail = email;
      }
      const count = await assetCollection.countDocuments(query);
      console.log({ email, count });

      const result = await assetCollection
        .find(query)
        .sort({
          dateAdded: -1,
        })
        .limit(Number(limit))
        .skip(Number(skip * limit))
        .toArray();
      res.send({ result, totalCount: count });
    });

    // getting a particular asset from DB
    app.get("/assets/:id", verifyJWTToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const asset = await assetCollection.findOne(query);
      if (!asset) {
        return res.status(404).send({ message: "Asset not found" });
      }
      if (asset.hrEmail !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      res.send(asset);
    });

    // updating the available quantity of an asset
    app.patch("/assets/:id", verifyJWTToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const updated = req.body;
      const query = { _id: new ObjectId(id) };
      const asset = await assetCollection.findOne(query);
      if (!asset) {
        return res.status(404).send({ message: "Asset not found" });
      }
      if (asset.hrEmail !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const update = {
        $set: {
          availableQuantity: updated.availableQuantity,
        },
      };
      const result = await assetCollection.updateOne(query, update);
      res.send(result);
    });

    // deleting an asset
    app.delete("/assets/:id", verifyJWTToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const asset = await assetCollection.findOne(query);
      if (!asset) {
        return res.status(404).send({ message: "Asset not found" });
      }
      if (asset.hrEmail !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const result = await assetCollection.deleteOne(query);
      res.send(result);
    });

    // request related APIs here
    // getting top requested 5 assets for a hr
    app.get("/requests/:email/topAssets", async (req, res) => {
      const email = req.params.email;
        if (email !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
      const topAssets = await requestCollection
        .aggregate([
          { $match: { hrEmail: email } },
          { $group: { _id: "$assetName", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
          { $project: { assetName: "$_id", count: 1, _id: 0 } },
        ])
        .toArray();
      res.send(topAssets);
    });
    // posting a request to DB
    app.post("/requests", verifyJWTToken, async (req, res) => {
      const request = req.body;
      if (request.requesterEmail !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const user = await usersCollection.findOne({ email: req.token_email });
      if (user?.role === "hr") {
        return res.status(403).send({ message: "HR cannot request assets" });
      }
      const result = await requestCollection.insertOne(request);
      res.send(result);
    });

    // getting total asset count for a particular employee for a hr for myEmployees page
    app.get("/requests", verifyJWTToken, verifyHR, async (req, res) => {
      //  console.log("received Query", req.query);
      const { requesterEmail, hrEmail, requestStatus } = req.query;
      const query = {};

      if (requesterEmail) {
        query.requesterEmail = requesterEmail;
      }
      if (hrEmail) {
        if (hrEmail !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
        query.hrEmail = hrEmail;
      }
      if (requestStatus) {
        query.requestStatus = requestStatus;
      }
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    // getting the requests for a particular hr
    app.get("/requests/:email", verifyJWTToken, verifyHR, async (req, res) => {
      const email = req.params.email;
      if (email !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const { limit = 0, page = 1 } = req.query;
      const skip = page - 1;
      const query = { hrEmail: email };
      const count = await requestCollection.countDocuments(query);
      const result = await requestCollection
        .find(query)
        .limit(Number(limit))
        .skip(Number(skip * limit))
        .toArray();
      res.send({ result, totalCount: count });
    });

    // getting top requested 5 assets
    app.get("/requests/topAssets", async (req, res) => {
      const topAssets = await requestCollection
        .aggregate([
          { $group: { _id: "$assetName", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
          { $project: { assetName: "$_id", count: 1, _id: 0 } },
        ])
        .toArray();
      res.send(topAssets);
    });

    // update the status of request
    app.patch("/requests/:id", verifyJWTToken, verifyHR, async (req, res) => {
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
    app.get("/employees", verifyJWTToken, verifyHR, async (req, res) => {
      const email = req.query.email;

      const companyName = req.query.companyName;

      const query = {};
      if (email) {
        if (email !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
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
    app.get("/companies", verifyJWTToken, async (req, res) => {
      const email = req.query.email;
      if (email && email !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
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
    app.delete("/employees", verifyJWTToken, verifyHR, async (req, res) => {
      const { hrEmail, employeeEmail } = req.query;
      const query = {};
      if (hrEmail) {
        if (hrEmail !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
        query.hrEmail = hrEmail;
      }
      if (employeeEmail) {
        query.employeeEmail = employeeEmail;
      }

      const hrQuery = await usersCollection.findOne({ email: hrEmail });
      const currentEmployeeUpdate = {
        $inc: {
          currentEmployees: -1,
        },
      };
      const decreaseCurrentEmployee = await usersCollection.updateOne(
        { _id: hrQuery._id },
        currentEmployeeUpdate
      );
      const result = await employeeAffiliations.deleteOne(query);
      res.send({ result, decreaseCurrentEmployee });
    });

    // posting assignedAssets to DB
    app.post("/assignedAssets", verifyJWTToken, async (req, res) => {
      const assignedAsset = req.body;
      const result = await assignedAssetsCollection.insertOne(assignedAsset);
      res.send(result);
    });

    // getting assignedAssets from DB
    app.get("/assignedAssets", verifyJWTToken, async (req, res) => {
      const email = req.query.email;
      if (email !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const query = { employeeEmail: email };
      const result = await assignedAssetsCollection.find(query).toArray();
      res.send(result);
    });

    //Stripe payment related APIS
    app.post(
      "/create-checkout-session",
      verifyJWTToken,
      verifyHR,
      async (req, res) => {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.cost) * 100;
        const currentPackageLimit = Number(paymentInfo.currentPackageLimit);
        const purchasedPackageLimit = Number(paymentInfo.purchasedPackageLimit);
        const packageLimit = Math.max(
          currentPackageLimit,
          purchasedPackageLimit
        );
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
          customer_email: paymentInfo.userEmail,
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
      }
    );

    // verifying the payment
    app.patch("/verifyPaymentSuccess", verifyJWTToken, async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log("session retrieve", session);

      //  check if the transactionId already exists as stripe creates unique transationID
      const existingPayment = await paymentsCollection.findOne({
        transactionId: session.payment_intent,
      });

      if (existingPayment) {
        console.log("Payment already exists, skipping duplicate insert.");
        return res.send({
          success: true,
          message: "Payment already processed.",
          trackingID: existingPayment.trackingID,
          transactionId: existingPayment.transactionId,
        });
      }

      const trackingID = generateTrackingId();
      if (session.payment_status === "paid") {
        const id = session.metadata.userId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            packageLimit: Number(session.metadata.packageLimit),
            subscription: session.metadata.name,
            trackingID: trackingID,
          },
        };
        const result = await usersCollection.updateOne(query, update);

        const paymentHistory = {
          hrEmail: session.customer_email,
          packageName: session.metadata.name,
          employeeLimit: Number(session.metadata.packageLimit),
          amount: session.amount_total / 100,
          transactionId: session.payment_intent,
          paymentDate: new Date(),
          status: session.payment_status,
        };

        const paymentHistoryResult = await paymentsCollection.insertOne(
          paymentHistory
        );

        return res.send({
          success: true,
          modifiedUser: result,
          trackingID: trackingID,
          transactionId: session.payment_intent,
          paymentInfo: paymentHistoryResult,
        });
      }

      res.send({ success: true });
    });

    // getting Payment history for a particular hr
    app.get("/paymentHistory", verifyJWTToken, verifyHR, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        if (email !== req.token_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
        query.hrEmail = email;
      }
      const cursor = paymentsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
