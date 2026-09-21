import { Router } from "express";
import { salesSummary, topProducts } from "../controllers/reports.controller.js";

const routes = Router();

routes.get("/sales", salesSummary);
routes.get("/top-products", topProducts);

export default routes;
