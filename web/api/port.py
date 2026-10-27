"""Import/export, backup and mutated-item endpoints (design doc P1).

Everything here is a thin layer over :mod:`web.services.port`, which reuses
pyfa's own ``service.port`` headless. Errors carry the design-doc vocabulary:
``importUnreadable`` / ``importUnsupported`` / ``importPartial`` /
``exportUnsupported`` as ``detail.code``.
"""

from fastapi import APIRouter, Depends, HTTPException
from logbook import Logger
from pydantic import BaseModel, Field

from web.deps import UserData, event_channel, get_user_data, user_or_guest, persist_after_response
from web.events import publish
from web.services import port as portService
from web.userdb import User

pyfalog = Logger(__name__)

router = APIRouter(prefix="/port", tags=["port"])
exportRouter = APIRouter(prefix="/fits", tags=["port"])
backupRouter = APIRouter(prefix="/backup", tags=["port"])
itemsRouter = APIRouter(prefix="/items", tags=["port"])


class ImportRequest(BaseModel):
    text: str = Field(..., description="Pasted or uploaded fit text")
    targetFitId: int | None = Field(
        None, description="Fit to apply item-level imports to (desktop 'paste into fit')")


class ExportRequest(BaseModel):
    format: str = Field(..., description="eft | dna | multibuy | shipstats | efs | esiJson")
    options: dict = Field(default_factory=dict)


class BackupImportRequest(BaseModel):
    text: str = Field(..., description="The XML backup document")


class MutantParseRequest(BaseModel):
    text: str = Field(..., description="Mutated module text, as copied from the desktop")


def _port_errors(ex: portService.PortError):
    return HTTPException(status_code=ex.status, detail=ex.detail())


@router.post("/import", status_code=201, dependencies=[Depends(persist_after_response)])
def import_text(
    payload: ImportRequest,
    user: User | None = Depends(user_or_guest),
    userData: UserData = Depends(get_user_data),
):
    """Import fit text: save new fits, or apply item text to an existing fit.

    Open to guests like every other write. When fits are created a
    ``fits.imported`` event is published so the ship tree refreshes.
    """
    channel = event_channel(user)
    try:
        result = portService.import_text(
            payload.text, target_fit_id=payload.targetFitId,
            userData=userData, channel=channel)
    except portService.PortError as ex:
        raise _port_errors(ex)
    if result["created"]:
        publish(channel, "fits.imported",
                fitIds=[fit["id"] for fit in result["created"]])
    if result["appliedToFitId"] is not None:
        publish(channel, "fit.changed", fitIds=[result["appliedToFitId"]], action="import")
    return result


@exportRouter.post("/{fit_id}/export")
def export_fit(
    fit_id: int,
    payload: ExportRequest,
):
    """Export a fit as text (EFT/DNA/multibuy/shipstats/EFS/ESI JSON).

    Read-only and open to guests like the existing ``GET export-txt``: a fit
    that exists can be copied out by whoever can open it.
    """
    from fastapi.responses import PlainTextResponse

    try:
        content, filename, content_type = portService.export_fit(
            fit_id, payload.format, payload.options)
    except portService.PortError as ex:
        raise _port_errors(ex)
    return PlainTextResponse(
        content,
        media_type=content_type,
        headers={"Content-Disposition": 'attachment; filename="{}"'.format(filename)})


@backupRouter.post("/export")
def backup_export():
    """All of the caller's fits as one XML document, downloaded as a file."""
    from fastapi.responses import PlainTextResponse

    content, filename = portService.export_backup()
    return PlainTextResponse(
        content,
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="{}"'.format(filename)})


@backupRouter.post("/import")
def backup_import(
    payload: BackupImportRequest,
    user: User | None = Depends(user_or_guest),
):
    """Restore fits from a backup XML document."""
    try:
        result = portService.import_backup(payload.text)
    except portService.PortError as ex:
        raise _port_errors(ex)
    publish(event_channel(user), "fits.imported", fitIds=[], action="backup")
    return result


@itemsRouter.post("/mutant/parse")
def parse_mutant(payload: MutantParseRequest):
    """Describe a mutated-module paste (base item, mutaplasmid, attribute values)."""
    try:
        return portService.parse_mutant(payload.text)
    except portService.PortError as ex:
        raise _port_errors(ex)


__all__ = ["router", "exportRouter", "backupRouter", "itemsRouter"]
