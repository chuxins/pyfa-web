import wx

import eos.db
import gui.mainFrame
from gui import globalEvents as GE
from service.fit import Fit


class GuiChangeCharCommand(wx.Command):

    def __init__(self, fitID, characterID):
        wx.Command.__init__(self, True, 'Change Character')
        self.fitID = fitID
        self.characterID = characterID
        self.previousCharacterID = None

    def Do(self):
        sFit = Fit.getInstance()
        fit = sFit.getFit(self.fitID)
        if fit is None:
            return False
        # ``Fit.changeChar`` happily sits the fit on whatever id it is handed; an
        # unknown character must be refused here or the fit is left without one.
        if eos.db.getCharacter(self.characterID) is None:
            return False
        self.previousCharacterID = fit.character.ID if fit.character is not None else None
        if self.previousCharacterID == self.characterID:
            return True
        sFit.changeChar(self.fitID, self.characterID)
        eos.db.commit()
        wx.PostEvent(gui.mainFrame.MainFrame.getInstance(), GE.FitChanged(fitIDs=(self.fitID,)))
        return True

    def Undo(self):
        if self.previousCharacterID is None:
            return True
        sFit = Fit.getInstance()
        sFit.changeChar(self.fitID, self.previousCharacterID)
        eos.db.commit()
        wx.PostEvent(gui.mainFrame.MainFrame.getInstance(), GE.FitChanged(fitIDs=(self.fitID,)))
        return True
