import { ObjectId } from "mongodb";
import { Request, Response } from "express";
import { getDb } from "../database/mongo.js";

function parseReportParams(req: Request):
  | { storeId: ObjectId; start: Date; end: Date }
  | { error: string } {
  const storeId = req.query.store_id;
  const start = req.query.start;
  const end = req.query.end;

  if (typeof storeId !== "string" || !ObjectId.isValid(storeId)) {
    return { error: "Provide a valid ObjectId in store_id" };
  }
  if (typeof start !== "string" || typeof end !== "string") {
    return { error: "start and end are required" };
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate >= endDate
  ) {
    return { error: "start and end must be valid dates with start before end" };
  }

  return { storeId: new ObjectId(storeId), start: startDate, end: endDate };
}

async function ensureActiveStore(storeId: ObjectId): Promise<boolean> {
  return Boolean(await getDb().collection("stores").findOne({ _id: storeId, active: true }));
}

export async function salesSummary(req: Request, res: Response): Promise<void> {
  try {
    const params = parseReportParams(req);
    if ("error" in params) {
      res.status(400).json({ error: params.error });
      return;
    }
    if (!(await ensureActiveStore(params.storeId))) {
      res.status(404).json({ error: "Store not found or inactive" });
      return;
    }

    const [summary] = await getDb().collection("orders").aggregate<{
      order_count: number;
      revenue_cents: number;
    }>([
      { $match: {
        store_id: params.storeId,
        status: "completed",
        created_at: { $gte: params.start, $lt: params.end }
      } },
      { $group: { _id: null, order_count: { $sum: 1 }, revenue_cents: { $sum: "$total_cents" } } }
    ]).toArray();

    const orderCount = summary?.order_count ?? 0;
    const revenue = summary?.revenue_cents ?? 0;
    res.json({
      data: {
        order_count: orderCount,
        revenue_cents: revenue,
        average_ticket_cents: orderCount === 0 ? 0 : Math.round(revenue / orderCount)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to summarize sales" });
  }
}

export async function topProducts(req: Request, res: Response): Promise<void> {
  try {
    const params = parseReportParams(req);
    if ("error" in params) {
      res.status(400).json({ error: params.error });
      return;
    }
    const rawLimit = req.query.limit ?? "10";
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ error: "limit must be an integer between 1 and 100" });
      return;
    }
    if (!(await ensureActiveStore(params.storeId))) {
      res.status(404).json({ error: "Store not found or inactive" });
      return;
    }

    const data = await getDb().collection("orders").aggregate([
      { $match: {
        store_id: params.storeId,
        status: "completed",
        created_at: { $gte: params.start, $lt: params.end }
      } },
      { $sort: { created_at: -1, _id: -1 } },
      { $unwind: "$items" },
      { $group: {
        _id: "$items.product_id",
        product_name: { $first: "$items.product_name" },
        quantity_sold: { $sum: "$items.quantity" },
        revenue_cents: { $sum: "$items.subtotal_cents" }
      } },
      { $project: { _id: 0, product_id: "$_id", product_name: 1, quantity_sold: 1, revenue_cents: 1 } },
      { $sort: { quantity_sold: -1, product_id: 1 } },
      { $limit: limit }
    ]).toArray();

    res.json({ data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to rank products" });
  }
}
