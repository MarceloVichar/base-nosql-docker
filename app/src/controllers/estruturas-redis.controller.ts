import { Request, Response } from "express";
import {
  hashSet,
  hashGetAll,
  hashIncr,
  listRange,
  listLen,
  setAdd,
  setMembers,
  setIsMember,
  zsetIncr,
  zsetRevRangeWithScores,
  expirar,
  cacheTtl,
} from "../database/redis.js";
import {
  chaveCarrinho,
  CHAVE_RANKING,
  CHAVE_CATEGORIAS_ATIVAS,
  CHAVE_PENDENTES,
} from "../services/cache-produtos.js";

/** TTL do carrinho: 24h de inatividade e o carrinho abandonado se apaga sozinho. */
const TTL_CARRINHO = 60 * 60 * 24;

/**
 * Controller das estruturas de dados do Redis (Checkpoint 2, Seção 3).
 *
 * Aqui o Redis não é cache: ele é o banco onde o dado vive. Cada resposta
 * devolve a `estrutura` e o `comando` usados, para deixar a escolha explícita.
 *
 * Padrão de nomes das chaves: `popsmarket:<entidade>:<id>`.
 */
export class EstruturasRedisController {
  // ===========================================================================
  // HASH — CARRINHO DE COMPRAS DO CLIENTE
  // popsmarket:carrinho:cliente:<cliente_id>
  // ===========================================================================

  /**
   * 1. CRIAR / SUBSTITUIR O CARRINHO
   * POST /api/redis/carrinho/:cliente_id
   * Body: { "cliente_nome": "Ana Silva", "status": "aberto" }
   */
  static async salvarCarrinho(req: Request, res: Response): Promise<void> {
    try {
      const { cliente_id } = req.params;
      const chave = chaveCarrinho(cliente_id);

      const campos: Record<string, string | number> = {
        ...req.body,
        atualizado_em: new Date().toISOString(),
      };

      await hashSet(chave, campos);
      await expirar(chave, TTL_CARRINHO);

      res.status(201).json({
        estrutura: "Hash",
        comando: "HSET + EXPIRE",
        chave,
        ttl_segundos: TTL_CARRINHO,
        carrinho: await hashGetAll(chave),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao salvar o carrinho no Redis", detalhe: err.message });
    }
  }

  /**
   * 2. LER O CARRINHO
   * GET /api/redis/carrinho/:cliente_id
   */
  static async obterCarrinho(req: Request, res: Response): Promise<void> {
    try {
      const { cliente_id } = req.params;
      const chave = chaveCarrinho(cliente_id);
      const carrinho = await hashGetAll(chave);

      if (Object.keys(carrinho).length === 0) {
        res.status(404).json({ erro: "Carrinho não encontrado ou já expirado.", chave });
        return;
      }

      res.json({
        estrutura: "Hash",
        comando: "HGETALL",
        chave,
        ttl_restante_segundos: await cacheTtl(chave),
        carrinho,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao ler o carrinho no Redis", detalhe: err.message });
    }
  }

  /**
   * 3. ADICIONAR UM ITEM AO CARRINHO
   * PATCH /api/redis/carrinho/:cliente_id/adicionar-item
   * Body: { "produto": "Fone JBL Tune 520", "quantidade": 2, "preco_unitario": 249.90 }
   *
   * O HINCRBY soma à quantidade sem reler e regravar o carrinho inteiro: é uma
   * operação atômica, o que evita perder um clique quando o cliente adiciona
   * dois itens em sequência rápida.
   */
  static async adicionarItem(req: Request, res: Response): Promise<void> {
    try {
      const { cliente_id } = req.params;
      const { produto, quantidade = 1, preco_unitario = 0 } = req.body ?? {};

      if (!produto) {
        res.status(400).json({ erro: "Informe o campo 'produto' no corpo da requisição." });
        return;
      }

      const chave = chaveCarrinho(cliente_id);
      const qtd = Number(quantidade);
      const valor = Number(preco_unitario) * qtd;

      const totalItens = await hashIncr(chave, "total_itens", qtd);
      const totalCentavos = await hashIncr(chave, "valor_total_centavos", Math.round(valor * 100));

      await hashSet(chave, {
        ultimo_produto: produto,
        status: "em_compra",
        atualizado_em: new Date().toISOString(),
      });
      await expirar(chave, TTL_CARRINHO);

      res.json({
        estrutura: "Hash",
        comando: "HINCRBY + HSET",
        chave,
        item_adicionado: { produto, quantidade: qtd, preco_unitario: Number(preco_unitario) },
        total_itens: totalItens,
        valor_total: Number((totalCentavos / 100).toFixed(2)),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao adicionar item ao carrinho", detalhe: err.message });
    }
  }

  // ===========================================================================
  // SORTED SET — RANKING DE PRODUTOS MAIS VENDIDOS
  // popsmarket:ranking:produtos
  // ===========================================================================

  /**
   * 4. REGISTRAR UMA VENDA NO RANKING
   * POST /api/redis/ranking/venda
   * Body: { "produto": "Notebook Lenovo IdeaPad 3", "quantidade": 3 }
   *
   * O ZINCRBY soma ao score e o Redis já reposiciona o membro: não é preciso
   * reordenar nada na aplicação.
   */
  static async registrarVenda(req: Request, res: Response): Promise<void> {
    try {
      const { produto, quantidade = 1 } = req.body ?? {};
      if (!produto) {
        res.status(400).json({ erro: "Informe o campo 'produto' no corpo da requisição." });
        return;
      }

      const total = await zsetIncr(CHAVE_RANKING, produto, Number(quantidade));

      res.json({
        estrutura: "Sorted Set",
        comando: "ZINCRBY",
        chave: CHAVE_RANKING,
        produto,
        quantidade_registrada: Number(quantidade),
        total_acumulado: total,
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao registrar a venda no ranking", detalhe: err.message });
    }
  }

  /**
   * 5. TOP N DO RANKING
   * GET /api/redis/ranking/top?limite=5
   *
   * ZREVRANGE ... WITHSCORES devolve os produtos já ordenados do mais vendido
   * para o menos vendido, em O(log N + M). A alternativa seria uma agregação
   * sobre a coleção `pedidos` a cada abertura do aplicativo.
   */
  static async listarTopVendidos(req: Request, res: Response): Promise<void> {
    try {
      const limite = Number(req.query.limite ?? 5);
      const top = await zsetRevRangeWithScores(CHAVE_RANKING, 0, limite - 1);

      res.json({
        estrutura: "Sorted Set",
        comando: `ZREVRANGE 0 ${limite - 1} WITHSCORES`,
        chave: CHAVE_RANKING,
        ranking: top.map((item, i) => ({
          posicao: i + 1,
          produto: item.membro,
          vendas: item.score,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar o ranking", detalhe: err.message });
    }
  }

  // ===========================================================================
  // SET — CATEGORIAS ATIVAS DO MARKETPLACE
  // popsmarket:categorias:ativas
  // ===========================================================================

  /**
   * 6. LISTAR AS CATEGORIAS ATIVAS
   * GET /api/redis/categorias
   */
  static async listarCategorias(req: Request, res: Response): Promise<void> {
    try {
      const membros = await setMembers(CHAVE_CATEGORIAS_ATIVAS);
      res.json({
        estrutura: "Set",
        comando: "SMEMBERS",
        chave: CHAVE_CATEGORIAS_ATIVAS,
        total: membros.length,
        categorias: membros.sort(),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar as categorias ativas", detalhe: err.message });
    }
  }

  /**
   * 7. ADICIONAR CATEGORIAS
   * POST /api/redis/categorias
   * Body: { "categorias": ["Games", "Eletrônicos"] }
   * O Set elimina duplicatas sozinho: "Eletrônicos" não entra duas vezes.
   */
  static async adicionarCategorias(req: Request, res: Response): Promise<void> {
    try {
      const { categorias } = req.body ?? {};
      if (!Array.isArray(categorias) || categorias.length === 0) {
        res.status(400).json({ erro: "Informe um array 'categorias' com ao menos um item." });
        return;
      }

      const inseridas = await setAdd(CHAVE_CATEGORIAS_ATIVAS, categorias.map(String));

      res.status(201).json({
        estrutura: "Set",
        comando: "SADD",
        chave: CHAVE_CATEGORIAS_ATIVAS,
        enviadas: categorias.length,
        novas_inseridas: inseridas,
        ignoradas_por_duplicidade: categorias.length - inseridas,
        categorias: (await setMembers(CHAVE_CATEGORIAS_ATIVAS)).sort(),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao adicionar categorias", detalhe: err.message });
    }
  }

  /**
   * 8. VERIFICAR SE UMA CATEGORIA É VÁLIDA
   * GET /api/redis/categorias/verificar?categoria=Eletrônicos
   * SISMEMBER é O(1): valida o cadastro de um produto sem ir ao MongoDB.
   */
  static async verificarCategoria(req: Request, res: Response): Promise<void> {
    try {
      const categoria = ((req.query.categoria as string) ?? "").trim();
      if (!categoria) {
        res.status(400).json({ erro: "Informe o parâmetro 'categoria'." });
        return;
      }

      res.json({
        estrutura: "Set",
        comando: "SISMEMBER",
        chave: CHAVE_CATEGORIAS_ATIVAS,
        categoria,
        pertence_ao_conjunto: await setIsMember(CHAVE_CATEGORIAS_ATIVAS, categoria),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao verificar a categoria", detalhe: err.message });
    }
  }

  // ===========================================================================
  // LIST — FILA DE SINCRONIZAÇÃO PENDENTE (usada na Seção 6)
  // popsmarket:sync:pendentes
  // ===========================================================================

  /**
   * 9. INSPECIONAR A FILA DE PENDÊNCIAS
   * GET /api/redis/sync/pendentes
   * A List preserva a ordem de chegada (FIFO), que é o que uma fila de
   * reprocessamento precisa: o produto que falhou primeiro é o primeiro a voltar.
   */
  static async listarPendentes(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        estrutura: "List",
        comando: "LRANGE 0 -1 + LLEN",
        chave: CHAVE_PENDENTES,
        total: await listLen(CHAVE_PENDENTES),
        pendentes: await listRange(CHAVE_PENDENTES, 0, -1),
      });
    } catch (err: any) {
      res.status(500).json({ erro: "Erro ao listar as pendências de sincronização", detalhe: err.message });
    }
  }
}
