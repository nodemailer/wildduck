| API path                       | API method | Test count | Has positive test? | Has Negative test? |
| ------------------------------ | :--------: | ---------- | ------------------ | ------------------ |
| `/users`                       |   `POST`   | 4          | ✅ (3)              | ✅ (2)              |
| `/authenticate`                |   `POST`   | 3          | ✅ (2)              | ✅ (1)              |
| `/authenticate`                |  `DELETE`  | 2          | ✅  (1)             | ✅     (1)          |
| `/users/resolve/{username}`    |   `GET`    | 2          | ✅ (1)              | ✅ (1)              |
| `/users/{user}`                |   `GET`    | 3          | ✅  (3)             | ❌                  |
| `/users/{user}`                |   `PUT`    | 2          | ✅       (2)        | ❌                  |
| `/users/{user}`                |  `DELETE`  | 1          | ✅ (1)              | ❌                  |
| `/users/resolve/{username}`    |   `GET`    | 2          | ✅    (1)           | ✅        (1)       |
| `/users/me`                    |   `GET`    | 1          | ✅   (1)            | ❌                  |
| `/users/{user}/logout`         |   `PUT`    | 1          | ✅         (1)      | ❌                  |
| ` /users/{user}/quota/reset`   |   `POST`   | 1          | ✅      (1)         | ❌                  |
| `/quota/reset`                 |   `POST`   | 1          | ✅  (1)             | ❌                  |
| `/users/{user}/password/reset` |   `POST`   | 2          | ✅         (1)      | ✅       (1)        |
| `/users/{user}/restore`        |   `GET`    | 1          | ✅ (1)              | ❌                  |
| `/users/{user}/restore`        |   `POST`   | 1          | ✅ (1)              | ❌                  |