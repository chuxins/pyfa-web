"""Server-sent events, so open tabs refresh themselves.

Mounted *outside* the bound-context router on purpose: an SSE connection stays
open for minutes, and holding the user's write lock for that long would stall
every other request from that user.
"""

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from logbook import Logger

from web.deps import current_user, event_channel
from web.events import bus

pyfalog = Logger(__name__)

router = APIRouter(prefix="/events", tags=["events"])

#: Send a comment this often so proxies do not close an idle stream
KEEPALIVE_SECONDS = 20

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Disable buffering in nginx-style proxies
    "X-Accel-Buffering": "no",
}


@router.get("")
async def stream(request: Request, user=Depends(current_user)):
    # Guests all work in the one shared guest database, so their browsers share a
    # single channel ("guest") the way every browser of one pilot shares that pilot's.
    channel = event_channel(user)
    queue = bus.subscribe(channel)

    async def publisher():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                payload = json.dumps(event, default=str)
                yield "event: {}\ndata: {}\n\n".format(event.get("type", "message"), payload)
        except asyncio.CancelledError:  # client went away
            raise
        finally:
            bus.unsubscribe(channel, queue)
            pyfalog.debug("SSE stream closed for channel {}", channel)

    return StreamingResponse(publisher(), media_type="text/event-stream", headers=SSE_HEADERS)
