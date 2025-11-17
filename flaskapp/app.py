from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)

@app.route("/", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        # No username/password check for now — just redirect
        return redirect(url_for("home"))
    return render_template("login.html")

@app.route("/home")
def home():
    return render_template("home.html")

@app.route("/scans")
def scans():
    return render_template("scans.html")

@app.route("/upload")
def upload():
    return render_template("upload.html")

@app.route("/notification")
def notification():
    return render_template("notification.html")

@app.route("/plan")
def plan():
    return render_template("plan.html")

@app.route("/profile")
def profile():
    return render_template("profile.html")

if __name__ == "__main__":
    app.run(debug=True)
