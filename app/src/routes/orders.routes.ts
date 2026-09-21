import { Router } from "express";
import { listOrders } from "../controllers/orders.controller.js";

const routes = Router();

routes.get("/", listOrders);

export default routes;
