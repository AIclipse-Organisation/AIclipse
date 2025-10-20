 document.addEventListener("DOMContentLoaded", () => {
        fetch("DummyData.json")
          .then((response) => {
            if (!response.ok) {
              throw new Error("Network response was not ok");
            }
            return response.json();
          })
          .then((data) => {
            const images = data.images || [];
            console.log("Images:", images);
            const posts = data.posts || [];
            console.log("posts:", posts);
            const comments = data.comments || [];
            console.log("comments:", comments);

            document.getElementById("images-data-box").textContent =
              JSON.stringify(images, null, 2);
            document.getElementById("posts-data-box").textContent =
              JSON.stringify(posts, null, 2);
            document.getElementById("comments-data-box").textContent =
              JSON.stringify(comments, null, 2);
          })
          .catch((error) => {
            const msg = "Error fetching data: " + error;
            document.getElementById("images-data-box").textContent = msg;
            document.getElementById("posts-data-box").textContent = msg;
            document.getElementById("comments-data-box").textContent = msg;
          });
      });

      document
        .getElementById("openPdfBtn")
        .addEventListener("click", function () {
          // Opens the PDF file in a new browser tab or window
          window.open("files/Community_algorithm.pdf", "_blank");
        });