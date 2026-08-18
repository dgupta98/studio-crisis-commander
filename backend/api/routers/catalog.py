"""HTTP surface for the catalog module."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from api.catalog import shelves as catalog_shelves

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/shelves")
async def shelves(region: str | None = Query(default=None, max_length=64)):
    return await asyncio.to_thread(catalog_shelves.build_shelves, region)


@router.get("/films/{film_id}")
async def film_detail(film_id: int):
    result = await asyncio.to_thread(catalog_shelves.get_film, film_id)
    if result is None:
        raise HTTPException(status_code=404, detail="film not found")
    return result


@router.get("/search")
async def search(q: str = Query(default="", max_length=64)):
    return await asyncio.to_thread(catalog_shelves.search_films, q)
