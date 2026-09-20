local ttt = require("ttt")

ttt.register({
  commands = {
    {
      id = "test.confirmDialog",
      title = "Test: Confirm Dialog",
      handler = function()
        ttt.confirm("Do you want to continue?", function()
          ttt.log("info", "User confirmed: YES")
        end)
      end,
    },
    {
      id = "test.clickAt",
      title = "Test: Click At 10,5",
      handler = function()
        ttt.click(10, 5)
        ttt.log("info", "Clicked at 10, 5")
      end,
    },
  },
})
