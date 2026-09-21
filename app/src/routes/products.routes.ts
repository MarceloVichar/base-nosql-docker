import { Router } from "express";
import { listProducts, getProduct } from "../controllers/products.controller.js";

const routes = Router();

routes.get("/", listProducts);

routes.get("/:id", getProduct);

export default routes;