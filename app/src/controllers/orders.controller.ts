import { ObjectId } from "mongodb";
import { Request, Response } from "express";
import { getDb } from "../database/mongo.js";

const queueStatuses = ["received", "preparing", "ready"] as const;

export async function listOrders(req: Request, res: Response): Promise<void> {
  try {
    const storeId = req.query.store_id;
    if (typeof storeId !== "string" || !ObjectId.isValid(storeId)) {
      res.status(400).json({ error: "Provide a valid ObjectId in store_id" });
      return;
    }

    const requestedStatus = req.query.status;
    if (
      requestedStatus !== undefined &&
      (typeof requestedStatus !== "string" ||
        !queueStatuses.includes(requestedStatus as typeof queueStatuses[number]))
    ) {
      res.status(400).json({ error: "Invalid order status" });
      return;
    }

    const page = Number(req.query.page ?? "1");
    const limit = Number(req.query.limit ?? "20");
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      res.status(400).json({
        error: "page must be a positive integer and limit must be between 1 and 100"
      });
      return;
    }

    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip)) {
      res.status(400).json({ error: "Page number is too large" });
      return;
    }

    const db = getDb();
    const store = await db.collection("stores").findOne({
      _id: new ObjectId(storeId),
      active: true
    });
    if (!store) {
      res.status(404).json({ error: "Store not found or inactive" });
      return;
    }

    const statusFilter = requestedStatus ?? { $in: queueStatuses };
    const orders = await db
      .collection("orders")
      .find({ store_id: new ObjectId(storeId), status: statusFilter })
      .project({
        _id: 1,
        terminal_code: 1,
        status: 1,
        "items.quantity": 1,
        "items.product_name": 1,
        "items.customizations": 1,
        "items.note": 1,
        created_at: 1
      })
      .sort({ created_at: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({ data: orders, page, limit });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to list orders" });
  }
}
